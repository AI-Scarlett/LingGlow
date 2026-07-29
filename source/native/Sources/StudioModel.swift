import Combine
import Foundation

enum BackendConnectionState: Equatable {
    case starting
    case connected
    case disconnected

    var label: String {
        switch self {
        case .starting: return LingGlowL10n.string("灵妆正在准备")
        case .connected: return LingGlowL10n.string("灵妆已就绪")
        case .disconnected: return LingGlowL10n.string("灵妆正在自动恢复")
        }
    }
}

enum LicenseActivationContext {
    case general
    case skin(CatalogSkin)
    case customSlot

    var isCustomSlot: Bool {
        if case .customSlot = self { return true }
        return false
    }
}

enum LicenseActivationPurpose: Equatable {
    case vip
    case skin(String)
    case customProfile(String)
    case unknown
}

@MainActor
final class StudioModel: ObservableObject {
    @Published var connectionState: BackendConnectionState = .starting
    @Published var selectedClient: ClientID = .codex
    @Published var status: StudioStatusResponse?
    @Published var catalogs: [ClientID: [CatalogSkin]] = [:]
    @Published var profiles: [SkinProfile] = []
    @Published var unionProfiles: [UnionProfile] = []
    /// Design-only records live in a separate backend store.  They deliberately
    /// never participate in resolveSkin, materialization, scheduling, or apply
    /// intents, even though they use the same union schema as executable
    /// profiles.
    @Published var unionProfileDrafts: [UnionProfile] = []
    @Published var capabilitySchemas: [ClientID: CapabilitySchemaResponse] = [:]
    @Published var productCatalog: ProductCatalogResponse?
    @Published var productCatalogError: String?
    @Published var isProductCatalogLoading = false
    @Published var freeBrand: WorkBuddyFreeBrand = .original
    @Published var schedule: WeeklySchedule?
    @Published var isBusy = false
    @Published var isTemplateSyncing = false
    @Published private(set) var batchSkinUpdateCompleted = 0
    @Published private(set) var batchSkinUpdateTotal = 0
    /// SwiftUI reads this through StudioRootView's locale environment, so a
    /// language change re-renders the currently visible interface immediately.
    @Published var interfaceLanguage = StudioModel.savedInterfaceLanguage()
    @Published var errorMessage: String?
    @Published var successMessage: String?
    @Published var licenseInput = ""
    @Published var redemptionSkinSelectionRequired = false
    @Published var pendingReminder: ScheduleReminder?

    private let bootstrapper = BackendBootstrapper()
    private var api: LocalAPI?
    private var pollingTask: Task<Void, Never>?
    private var productCatalogTask: Task<Void, Never>?
    private var lastPresentedReminderKey: String?
    private var selectionRequiredLicenseInput: String?
    private var errorIsConnectionFailure = false
    private var consecutiveConnectionFailures = 0

    var entitlement: EntitlementInfo? { status?.entitlement }
    var isVIP: Bool { entitlement?.isVIP == true }
    var canEditCustomProfiles: Bool {
        isVIP || entitlement?.unlockedCustomProfileIds.isEmpty == false
    }
    var accessibleProfiles: [SkinProfile] {
        guard !isVIP else { return profiles }
        let profileIds = entitlement?.unlockedCustomProfileIds ?? []
        return profiles.filter { profileIds.contains($0.id) }
    }
    var accessibleUnionProfiles: [UnionProfile] {
        guard !isVIP else { return unionProfiles }
        let profileIds = entitlement?.unlockedCustomProfileIds ?? []
        return unionProfiles.filter { profileIds.contains($0.id) }
    }
    var accessibleUnionProfileDrafts: [UnionProfile] {
        guard !isVIP else { return unionProfileDrafts }
        let profileIds = entitlement?.unlockedCustomProfileIds ?? []
        return unionProfileDrafts.filter { profileIds.contains($0.id) }
    }
    var selectedStatus: ClientStatus? { status?.clients[selectedClient.rawValue] }
    var selectedCatalog: [CatalogSkin] { catalogs[selectedClient] ?? [] }
    var redemptionSkins: [RedemptionSkin] { productCatalog?.redemptionSkins ?? [] }
    var customProfileSlotIds: [String] {
        (entitlement?.unlockedCustomProfileIds ?? []).sorted()
    }
    var interfaceLocale: Locale { Locale(identifier: interfaceLanguage) }
    var isBatchUpdatingSkins: Bool { batchSkinUpdateTotal > 0 }

    func setInterfaceLanguage(_ value: String) {
        let normalized = value == "en" ? "en" : "zh-Hans"
        guard interfaceLanguage != normalized else { return }
        UserDefaults.standard.set(normalized, forKey: LingGlowL10n.preferenceKey)
        // Dynamic AppKit/SwiftUI strings read LingGlowL10n during the
        // @Published refresh. Persist first so that refresh observes the new
        // language instead of leaving tabs and status rows in the old one.
        // Transient messages were rendered in the previous language; dismiss
        // them instead of leaving a stale-language banner on the rebuilt view.
        clearMessages()
        interfaceLanguage = normalized
    }

    private static func savedInterfaceLanguage() -> String {
        if let saved = UserDefaults.standard.string(forKey: LingGlowL10n.preferenceKey),
           saved == "en" || saved == "zh-Hans" {
            return saved
        }
        return Locale.preferredLanguages.first?.hasPrefix("en") == true ? "en" : "zh-Hans"
    }

    /// New custom profiles deliberately start with every known union field.
    /// The target-specific projection still controls what is shown/editable,
    /// but a future Agent switch never has to infer missing values.  Older
    /// local hosts may omit `fields`, in which case the visible projection is
    /// the safe compatibility fallback and the server fills the rest on save.
    func unionDefaults(from schema: CapabilitySchemaResponse) -> [String: JSONValue] {
        if let fields = schema.fields, !fields.isEmpty {
            return Dictionary(uniqueKeysWithValues: fields.map { ($0.id, $0.defaultValue) })
        }
        return Dictionary(uniqueKeysWithValues: schema.editorProjection.fields.map { ($0.id, $0.value) })
    }

    /// The weekly scheduler must expose both catalog packs and the exact
    /// custom profiles the current entitlement is allowed to use.  Otherwise a
    /// permanently purchased custom slot could be saved and applied manually
    /// but could never be selected for a daily reminder.
    func scheduleSkinOptions(for client: ClientID) -> [ScheduleSkinOption] {
        var result: [ScheduleSkinOption] = []
        var seenIds = Set<String>()

        func append(_ option: ScheduleSkinOption) {
            guard seenIds.insert(option.id).inserted else { return }
            result.append(option)
        }

        for skin in catalogs[client] ?? [] where canUse(skin) && skin.isInstalled {
            append(ScheduleSkinOption(
                id: skin.id,
                name: skin.name,
                isVIP: skin.isVIP,
                isCustom: false
            ))
        }

        for profile in unionProfiles where profile.targetClientId == client.rawValue &&
            canPersistCustomProfile(id: profile.id) {
            append(ScheduleSkinOption(
                id: profile.id,
                name: profile.name,
                isVIP: true,
                isCustom: true
            ))
        }

        // Legacy v1 profiles are WorkBuddy-only. Keep them schedulable while
        // people migrate to the union schema so an existing paid slot does not
        // lose its weekly automation.
        if client == .workbuddy {
            for profile in accessibleProfiles {
                append(ScheduleSkinOption(
                    id: profile.id,
                    name: profile.name,
                    isVIP: true,
                    isCustom: true
                ))
            }
        }

        return result
    }

    func canPersistCustomProfile(id: String) -> Bool {
        isVIP || entitlement?.unlockedCustomProfileIds.contains(id) == true
    }

    func isUnionProfileDraft(_ profile: UnionProfile) -> Bool {
        unionProfileDrafts.contains {
            $0.id == profile.id && $0.targetClientId == profile.targetClientId
        }
    }

    /// A persisted profile's target is part of its identity.  In particular,
    /// a permanent custom slot must not be silently re-purposed from a saved
    /// Doubao design draft into an executable WorkBuddy/Codex skin (or vice
    /// versa). A newly redeemed, still-unsaved custom slot deliberately stays
    /// target-selectable until its first save.
    func isUnionProfileTargetLocked(_ profile: UnionProfile) -> Bool {
        return unionProfiles.contains { $0.id == profile.id } ||
            unionProfileDrafts.contains { $0.id == profile.id }
    }

    func checkoutUnavailableReason(for product: ProductCatalogItem) -> String? {
        guard let catalog = productCatalog else {
            return productCatalogError ?? LingGlowL10n.string("正在读取 Dodo Payments 商品目录")
        }
        guard catalog.products.contains(where: { $0.id == product.id }) else {
            return LingGlowL10n.string("该商品已不在本地宿主发布的目录中")
        }
        guard !catalog.commerce.usesTestProductDirectory else {
            return catalog.commerce.unavailableReason
        }
        guard catalog.commerce.configured, catalog.commerce.checkoutEnabled else {
            return catalog.commerce.unavailableReason
        }
        guard product.safeCheckoutURL != nil else {
            return LingGlowL10n.string("本地宿主尚未返回 Dodo 官方托管结算链接")
        }
        return nil
    }

    func canUse(_ skin: CatalogSkin) -> Bool {
        !skin.isVIP ||
            isVIP ||
            entitlement?.purchasedSkinIds.contains(skin.id) == true
    }

    func installRemoteSkin(_ skin: CatalogSkin) async {
        guard !isBusy else { return }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let response = try await connected.installRemoteSkin(skin.id, for: selectedClient)
            catalogs[selectedClient] = response.skins
            successMessage = skin.updateAvailable == true
                ? LingGlowL10n.string("已更新皮肤：%@", LingGlowL10n.string(skin.name))
                : LingGlowL10n.string("已下载皮肤：%@，现在可以应用", LingGlowL10n.string(skin.name))
        } catch {
            report(error)
        }
    }

    func availableSkinUpdateCount(for client: ClientID) -> Int {
        Set((catalogs[client] ?? []).filter { $0.updateAvailable == true }.map(\.id)).count
    }

    /// Remote Theme Packs share one private install store. Update them in a
    /// deterministic sequence so two downloads never replace the same receipt
    /// or materialized catalog directory concurrently. One failed package does
    /// not prevent the remaining verified packages from updating.
    func updateAllRemoteSkins(for client: ClientID) async {
        guard !isBusy else { return }
        var seenIds = Set<String>()
        let updates = (catalogs[client] ?? []).filter { skin in
            skin.updateAvailable == true && seenIds.insert(skin.id).inserted
        }
        clearMessages()
        guard !updates.isEmpty else {
            successMessage = LingGlowL10n.string("当前没有需要更新的皮肤")
            return
        }

        isBusy = true
        batchSkinUpdateCompleted = 0
        batchSkinUpdateTotal = updates.count
        defer {
            batchSkinUpdateCompleted = 0
            batchSkinUpdateTotal = 0
            isBusy = false
        }

        let connected: LocalAPI
        do {
            connected = try await connectedAPI()
        } catch {
            report(error)
            return
        }

        var updatedNames: [String] = []
        var failedNames: [String] = []
        for skin in updates {
            do {
                let response = try await connected.installRemoteSkin(skin.id, for: client)
                catalogs[client] = response.skins
                updatedNames.append(LingGlowL10n.string(skin.name))
            } catch {
                failedNames.append(LingGlowL10n.string(skin.name))
            }
            batchSkinUpdateCompleted += 1
        }

        if failedNames.isEmpty {
            successMessage = LingGlowL10n.string("已更新全部 %lld 套皮肤", updatedNames.count)
        } else {
            errorMessage = LingGlowL10n.string(
                "已更新 %lld/%lld 套；失败：%@。可单独重试失败项目。",
                updatedNames.count,
                updates.count,
                failedNames.joined(separator: "、")
            )
            errorIsConnectionFailure = false
        }
    }

    func connectAndRefresh() async {
        guard !isBusy else { return }
        isBusy = true
        connectionState = .starting
        clearMessages()
        do {
            let connected = try await bootstrapper.ensureRunning()
            api = connected
            do {
                try await loadSnapshot(using: connected)
            } catch {
                try await Task.sleep(nanoseconds: 500_000_000)
                try await loadSnapshot(using: connected)
            }
            connectionState = .connected
            clearRecoveredConnectionError()
        } catch {
            api = nil
            registerConnectionFailure(error, showMessage: false)
        }
        isBusy = false
    }

    /// Catalog refresh deliberately has its own state.  A GitHub template
    /// check must never disable Apply or Download; only the Sync button waits
    /// for the in-flight request. The backend serves its verified cache until
    /// it is one hour old, unless this is the explicit manual action.
    func refreshAll(manuallySyncTemplates: Bool = false) async {
        guard !isTemplateSyncing else { return }
        isTemplateSyncing = true
        if manuallySyncTemplates { clearMessages() }
        defer { isTemplateSyncing = false }
        do {
            let connected = try await connectedAPI()
            try await loadCatalogs(
                using: connected,
                manuallySyncingTemplates: manuallySyncTemplates
            )
            connectionState = .connected
            clearRecoveredConnectionError()
            let updates = catalogs.values.flatMap { $0 }.filter { $0.updateAvailable == true }.count
            if manuallySyncTemplates {
                successMessage = updates > 0
                    ? LingGlowL10n.string("模板目录已更新，发现 %lld 套模板可更新", updates)
                    : LingGlowL10n.string("模板目录已是最新")
            }
        } catch {
            // Automatic refresh is intentionally quiet: the user can continue
            // working from the last verified local catalog. Manual sync shows
            // the actionable error without treating the local host as offline.
            if manuallySyncTemplates { report(error) }
        }
    }

    func loadProductCatalogIfNeeded(force: Bool = false) async {
        if let task = startProductCatalogLoad(force: force) {
            await task.value
        }
    }

    func refreshDoctor() async {
        guard !isBusy else { return }
        isBusy = true
        clearMessages()
        do {
            let connected = try await connectedAPI()
            let freshStatus = try await connected.doctorRefresh()
            try verifyIdentity(freshStatus, api: connected)
            acceptStatus(freshStatus)
            var refreshedCatalogs: [ClientID: [CatalogSkin]] = [:]
            for client in ClientID.allCases {
                do {
                    refreshedCatalogs[client] = try await connected.catalog(for: client).skins
                } catch where client == .doubao {
                    refreshedCatalogs[client] = []
                }
            }
            catalogs = refreshedCatalogs
            connectionState = .connected
            clearRecoveredConnectionError()
            successMessage = LingGlowL10n.string("安全检测已更新")
        } catch {
            report(error)
        }
        isBusy = false
    }

    func startPolling() {
        guard pollingTask == nil else { return }
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { break }
                // Every failed recovery poll relaunches the packaged backend and
                // waits out a full handshake window, so back off while recovery
                // keeps failing instead of spawning a child every two seconds.
                let retries = min(self.consecutiveConnectionFailures, 5)
                let delay: UInt64 = self.connectionState == .connected
                    ? 15_000_000_000
                    : min(2_000_000_000 << retries, 60_000_000_000)
                do {
                    try await Task.sleep(nanoseconds: delay)
                } catch {
                    break
                }
                await self.refreshStatusSilently()
            }
        }
    }

    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    func createApplyIntent(for skin: CatalogSkin) async -> ApplyIntent? {
        guard !isBusy else { return nil }
        guard canUse(skin) else {
            errorMessage = LingGlowL10n.string("这套皮肤需要有效 VIP 或该皮肤的购买/兑换授权")
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            return try await createApplyIntentWithRecovery(
                client: selectedClient,
                skinId: skin.id
            ).1
        } catch {
            report(error)
            return nil
        }
    }

    /// Applies one catalog skin to the checked Agents after a single native
    /// confirmation. Every target keeps its own server-side intent and
    /// fingerprint check; failures are isolated so one Agent cannot hide the
    /// result of the remaining checked targets. ClientID.allCases deliberately
    /// keeps Codex last, avoiding an early restart of the user's active Agent.
    func applyCatalogSkin(_ skin: CatalogSkin, to requestedClients: Set<ClientID>) async -> [AgentSkinApplyOutcome] {
        guard !isBusy, !requestedClients.isEmpty else { return [] }
        guard canUse(skin) else {
            errorMessage = LingGlowL10n.string("这套皮肤需要有效 VIP 或该皮肤的购买/兑换授权")
            return []
        }

        let clients = ClientID.allCases.filter { requestedClients.contains($0) }
        isBusy = true
        clearMessages()
        defer { isBusy = false }

        var outcomes: [AgentSkinApplyOutcome] = []
        for client in clients {
            guard let targetSkin = catalogs[client]?.first(where: { $0.id == skin.id }) else {
                outcomes.append(AgentSkinApplyOutcome(
                    client: client,
                    succeeded: false,
                    message: LingGlowL10n.string("这套皮肤不支持该 Agent")
                ))
                continue
            }
            guard canUse(targetSkin) else {
                outcomes.append(AgentSkinApplyOutcome(
                    client: client,
                    succeeded: false,
                    message: LingGlowL10n.string("尚未获得这套皮肤的使用权益")
                ))
                continue
            }
            guard targetSkin.isInstalled else {
                outcomes.append(AgentSkinApplyOutcome(
                    client: client,
                    succeeded: false,
                    message: LingGlowL10n.string("请先下载这套皮肤")
                ))
                continue
            }

            do {
                let (connected, intent) = try await createApplyIntentWithRecovery(
                    client: client,
                    skinId: targetSkin.id
                )
                try await confirmApplyWithRecovery(
                    connected,
                    intent: intent,
                    client: client,
                    skinId: targetSkin.id
                )
                outcomes.append(AgentSkinApplyOutcome(
                    client: client,
                    succeeded: true,
                    message: LingGlowL10n.string("已应用并重新启动")
                ))
            } catch {
                outcomes.append(AgentSkinApplyOutcome(
                    client: client,
                    succeeded: false,
                    message: displayMessage(for: error)
                ))
            }
        }

        do {
            let connected = try await connectedAPI()
            let freshStatus = try await connected.status()
            try verifyIdentity(freshStatus, api: connected)
            acceptStatus(freshStatus)
        } catch {
            // Per-Agent outcomes are already authoritative. Keep them visible
            // even if the lightweight post-operation refresh was interrupted.
            registerConnectionFailure(error, showMessage: true)
        }

        let succeeded = outcomes.filter(\.succeeded)
        let failed = outcomes.filter { !$0.succeeded }
        if failed.isEmpty {
            successMessage = LingGlowL10n.string(
                "已将「%@」应用到 %lld 个 Agent",
                LingGlowL10n.string(skin.name),
                succeeded.count
            )
        } else if !succeeded.isEmpty {
            successMessage = LingGlowL10n.string(
                "已应用到 %lld 个 Agent；另有 %lld 个未完成",
                succeeded.count,
                failed.count
            )
        } else {
            errorMessage = LingGlowL10n.string("所选 Agent 均未能完成应用")
        }
        return outcomes
    }

    /// Creating an intent is safe to retry once: an unobserved first intent is
    /// short-lived and cannot apply anything without its matching confirmation.
    /// This closes the common stale-session window without replaying a restart.
    private func createApplyIntentWithRecovery(
        client: ClientID,
        skinId: String
    ) async throws -> (LocalAPI, ApplyIntent) {
        do {
            let connected = try await connectedAPI()
            let intent = try await connected.createIntent(
                client: client,
                skinId: skinId,
                operation: "apply"
            ).intent
            return (connected, intent)
        } catch {
            guard isConnectionFailure(error) else { throw error }
            api = nil
            connectionState = .starting
            errorIsConnectionFailure = true
            let recovered = try await connectedAPI()
            let intent = try await recovered.createIntent(
                client: client,
                skinId: skinId,
                operation: "apply"
            ).intent
            return (recovered, intent)
        }
    }

    /// A confirmation is not replayed after a transport interruption because
    /// it may already have restarted the target. Reconnect to the authenticated
    /// local service and reconcile the authoritative Agent session instead.
    private func confirmApplyWithRecovery(
        _ connected: LocalAPI,
        intent: ApplyIntent,
        client: ClientID,
        skinId: String
    ) async throws {
        do {
            _ = try await connected.confirm(intent: intent)
            return
        } catch {
            guard isConnectionFailure(error) else { throw error }
            api = nil
            connectionState = .starting
            errorIsConnectionFailure = true

            for attempt in 0..<40 {
                do {
                    _ = try await connectedAPI()
                    guard let target = status?.clients[client.rawValue] else {
                        throw NativeStudioError.invalidResponse
                    }
                    if target.session.state == "active",
                       target.session.profileId == skinId,
                       target.session.injectedTargets > 0 {
                        return
                    }
                    if target.session.state == "error" {
                        throw NativeStudioError.backendUnavailable(
                            target.session.lastError ?? "Agent 皮肤会话启动失败"
                        )
                    }
                } catch {
                    if !isConnectionFailure(error) { throw error }
                    api = nil
                }
                if attempt < 39 {
                    try await Task.sleep(nanoseconds: 250_000_000)
                }
            }
            throw NativeStudioError.backendUnavailable(
                "本机服务已自动恢复，但未能确认 Agent 已完成应用"
            )
        }
    }

    func createRestoreIntent() async -> ApplyIntent? {
        guard !isBusy else { return nil }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            return try await connected.createIntent(
                client: selectedClient,
                skinId: nil,
                operation: "restore"
            ).intent
        } catch {
            report(error)
            return nil
        }
    }

    /// The free WorkBuddy identity layer is stored independently from a skin.
    /// Re-applying the active skin is therefore explicit and still passes
    /// through the same one-time restart confirmation as every other apply.
    func createReapplyCurrentClientIntent() async -> ApplyIntent? {
        guard !isBusy else { return nil }
        guard let client = status?.clients[selectedClient.rawValue],
              client.installed,
              client.compatibility.advancedAllowed,
              let profileId = client.session.profileId else {
            errorMessage = LingGlowL10n.string("请先应用一套 %@ 皮肤，再重新应用免费外观覆盖", selectedClient.displayName)
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            return try await connected.createIntent(
                client: selectedClient,
                skinId: profileId,
                operation: "apply"
            ).intent
        } catch {
            report(error)
            return nil
        }
    }

    func createApplyIntent(for profile: SkinProfile) async -> ApplyIntent? {
        guard !isBusy else { return nil }
        guard canPersistCustomProfile(id: profile.id) else {
            errorMessage = LingGlowL10n.string("应用自定义皮肤需要有效 VIP 或与该 profileId 精确绑定的自定义位授权")
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            return try await connected.createIntent(
                client: .workbuddy,
                skinId: profile.id,
                operation: "apply"
            ).intent
        } catch {
            report(error)
            return nil
        }
    }

    func workBuddyEditorProfile() async -> SkinProfile? {
        guard !isBusy else { return nil }
        guard canEditCustomProfiles else {
            errorMessage = LingGlowL10n.string("自定义项目页图片需要有效 VIP 或自定义皮肤位授权")
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let allowedIds = entitlement?.unlockedCustomProfileIds ?? []
            let activeId = status?.clients[ClientID.workbuddy.rawValue]?.session.profileId

            if let activeId,
               let profile = profiles.first(where: {
                   $0.id == activeId && (isVIP || allowedIds.contains($0.id))
               }) {
                return profile
            }
            if let boundId = allowedIds.sorted().first,
               let profile = profiles.first(where: { $0.id == boundId }) {
                return profile
            }
            if isVIP, let profile = profiles.first {
                return profile
            }

            let targetId = allowedIds.sorted().first ?? "workbuddy-project-hero"
            var profile = SkinProfile.defaultWorkBuddy(id: targetId)
            if let activeId,
               catalogs[.workbuddy]?.contains(where: { $0.id == activeId }) == true {
                let template = try await connected.profileTemplate(client: .workbuddy, skinId: activeId).profile
                profile = template
                profile.id = targetId
                profile.name = String("\(template.name) · 自定义".prefix(60))
                let now = ISO8601DateFormatter().string(from: Date())
                profile.createdAt = now
                profile.updatedAt = now
            }
            return profile
        } catch {
            report(error)
            return nil
        }
    }

    func saveProfile(_ profile: SkinProfile) async -> SkinProfile? {
        guard !isBusy else { return nil }
        guard canPersistCustomProfile(id: profile.id) else {
            errorMessage = LingGlowL10n.string("保存自定义皮肤需要有效 VIP 或与该 profileId 精确绑定的自定义位授权")
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let saved = try await connected.saveProfile(profile).profile
            profiles.removeAll { $0.id == saved.id }
            profiles.insert(saved, at: 0)
            successMessage = LingGlowL10n.string("已保存「%@」", saved.name)
            return saved
        } catch {
            report(error)
            return nil
        }
    }

    func customEditorProfile(
        for client: ClientID,
        preferredProfileId: String? = nil
    ) async -> UnionProfile? {
        guard !isBusy else { return nil }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let latestProfiles = try await connected.unionProfiles().profiles
            let latestDrafts = try await connected.unionProfileDrafts().profiles
            unionProfiles = latestProfiles
            unionProfileDrafts = latestDrafts
            let allowedIds = entitlement?.unlockedCustomProfileIds ?? []
            let activeId = status?.clients[client.rawValue]?.session.profileId

            if let preferredProfileId, !isVIP, !allowedIds.contains(preferredProfileId) {
                errorMessage = LingGlowL10n.string("所选自定义位不属于当前已验证授权")
                return nil
            }

            let boundProfileId: String? = {
                guard !isVIP else { return nil }
                if let preferredProfileId { return preferredProfileId }
                if let activeId, allowedIds.contains(activeId) { return activeId }
                return allowedIds.sorted().first
            }()

            func schema(for target: ClientID) async throws -> CapabilitySchemaResponse {
                let value = try await connected.capabilitySchema(for: target)
                capabilitySchemas[target] = value
                return value
            }

            if let boundProfileId {
                if let existing = (latestProfiles + latestDrafts).first(where: { $0.id == boundProfileId }) {
                    // A permanently purchased custom slot is one skin.  Its
                    // target Agent becomes part of that skin when it is first
                    // saved as either an executable profile or a design-only
                    // draft. Load that Agent's schema instead of silently
                    // repurposing the slot when the picker is opened elsewhere.
                    if let target = ClientID(rawValue: existing.targetClientId) {
                        _ = try await schema(for: target)
                    }
                    return existing
                }
                let value = try await schema(for: client)
                let defaults = unionDefaults(from: value)
                return UnionProfile(
                    id: boundProfileId,
                    name: LingGlowL10n.string("我的 %@ 皮肤", client.displayName),
                    targetClientId: client.rawValue,
                    schemaVersion: value.schemaVersion,
                    values: defaults
                )
            }

            let value = try await schema(for: client)

            // A saved design draft is always loaded before creating a new
            // profile. If this Agent becomes available in a later release,
            // the editor can offer an explicit draft-promotion action instead
            // of silently creating a second profile or auto-applying it.
            if let matchingDraft = latestDrafts.first(where: {
                $0.targetClientId == client.rawValue && canPersistCustomProfile(id: $0.id)
            }) {
                return matchingDraft
            }

            // A blocked target is design-only. Prefer an existing draft and
            // never return an executable profile as a candidate for a blocked
            // Agent. Draft records remain in their isolated backend store and
            // are therefore invisible to materialization and scheduling.
            if value.capabilityMap.runtimeStatus == "blocked" {
                let id: String
                if isVIP {
                    let base = "custom-\(client.rawValue)-profile"
                    var candidate = base
                    var suffix = 2
                    let occupiedIds = Set((latestProfiles + latestDrafts).map(\.id))
                    while occupiedIds.contains(candidate) {
                        candidate = "\(base)-\(suffix)"
                        suffix += 1
                    }
                    id = candidate
                } else {
                    // A free user may still preview every union field, but a
                    // design-only draft still requires a paid custom slot.
                    id = "preview-\(client.rawValue)-profile"
                }
                return UnionProfile(
                    id: id,
                    name: LingGlowL10n.string("我的 %@ 设计草稿", client.displayName),
                    targetClientId: client.rawValue,
                    schemaVersion: value.schemaVersion,
                    values: unionDefaults(from: value)
                )
            }

            // Only the reviewed `blocked` state can use the isolated draft
            // endpoint. A future/unknown state remains a read-only preview
            // until an explicit capability policy is shipped for it.
            guard value.capabilityMap.runtimeStatus == "available" else {
                return UnionProfile(
                    id: "preview-\(client.rawValue)-profile",
                    name: LingGlowL10n.string("我的 %@ 皮肤", client.displayName),
                    targetClientId: client.rawValue,
                    schemaVersion: value.schemaVersion,
                    values: unionDefaults(from: value)
                )
            }

            if let activeId,
               let active = latestProfiles.first(where: {
                   $0.id == activeId && $0.targetClientId == client.rawValue && canPersistCustomProfile(id: $0.id)
               }) {
                return active
            }
            if let matching = latestProfiles.first(where: {
                $0.targetClientId == client.rawValue && canPersistCustomProfile(id: $0.id)
            }) {
                return matching
            }

            let id: String
            if isVIP {
                let base = "custom-\(client.rawValue)-profile"
                var candidate = base
                var suffix = 2
                let existingIds = Set((latestProfiles + latestDrafts).map(\.id))
                while existingIds.contains(candidate) {
                    candidate = "\(base)-\(suffix)"
                    suffix += 1
                }
                id = candidate
            } else {
                // A free user without a bound custom slot can still use the
                // complete editor as a local preview, but cannot persist it.
                id = "preview-\(client.rawValue)-profile"
            }
            let defaults = unionDefaults(from: value)
            return UnionProfile(
                id: id,
                name: LingGlowL10n.string("我的 %@ 皮肤", client.displayName),
                targetClientId: client.rawValue,
                schemaVersion: value.schemaVersion,
                values: defaults
            )
        } catch {
            report(error)
            return nil
        }
    }

    func loadCapabilitySchema(for client: ClientID) async -> CapabilitySchemaResponse? {
        guard !isBusy else { return capabilitySchemas[client] }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let schema = try await connected.capabilitySchema(for: client)
            capabilitySchemas[client] = schema
            return schema
        } catch {
            report(error)
            return nil
        }
    }

    func saveUnionProfile(_ profile: UnionProfile) async -> UnionProfile? {
        guard !isBusy else { return nil }
        guard canPersistCustomProfile(id: profile.id) else {
            errorMessage = LingGlowL10n.string("免费用户只能预览；保存需要有效 VIP 或与此 profileId 绑定的自定义位授权")
            return nil
        }
        guard let client = ClientID(rawValue: profile.targetClientId) else {
            errorMessage = LingGlowL10n.string("自定义皮肤的目标 Agent 无效")
            return nil
        }
        if let existing = (unionProfiles + unionProfileDrafts).first(where: { $0.id == profile.id }),
           existing.targetClientId != profile.targetClientId {
            errorMessage = LingGlowL10n.string("这个已保存方案的目标 Agent 已固定，不能用同一 profileId 改作其他 Agent")
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let schema: CapabilitySchemaResponse
            if let cached = capabilitySchemas[client] {
                schema = cached
            } else {
                schema = try await connected.capabilitySchema(for: client)
                capabilitySchemas[client] = schema
            }
            if schema.capabilityMap.runtimeStatus == "blocked" {
                // This route stores the complete union schema in the separate
                // draft-only backend store. It never becomes resolveSkin()
                // input, a schedule option, or an executable injection.
                let saved = try await connected.saveUnionProfileDraft(profile).profile
                unionProfileDrafts.removeAll { $0.id == saved.id }
                unionProfileDrafts.insert(saved, at: 0)
                successMessage = LingGlowL10n.string("已保存不可执行设计草稿「%@」；未注入、未加入排程，也不能应用", saved.name)
                return saved
            }
            guard schema.capabilityMap.runtimeStatus == "available" else {
                errorMessage = LingGlowL10n.string("%@ 当前能力状态未获批准；仅可预览，不能保存或应用", client.displayName)
                return nil
            }
            let saved = try await connected.saveUnionProfile(profile).profile
            unionProfiles.removeAll { $0.id == saved.id }
            unionProfiles.insert(saved, at: 0)
            successMessage = LingGlowL10n.string("已保存「%@」", saved.name)
            return saved
        } catch {
            report(error)
            return nil
        }
    }

    /// Produce a Codex-owned official theme string from the private persisted
    /// union-profile store. A local editor draft is intentionally insufficient:
    /// exporting must not make an unsaved value look like a durable theme.
    /// This method has no Apply Intent, target-process, CDP, or restart path.
    func exportCodexOfficialTheme(for profile: UnionProfile) async -> CodexOfficialThemeExportResponse? {
        guard !isBusy else { return nil }
        guard profile.targetClientId == ClientID.codex.rawValue else {
            errorMessage = LingGlowL10n.string("只能导出 Codex 自定义皮肤的官方主题")
            return nil
        }
        guard unionProfiles.contains(where: {
            $0 == profile && $0.targetClientId == ClientID.codex.rawValue
        }) else {
            errorMessage = LingGlowL10n.string("请先保存这套 Codex 自定义皮肤的最新修改；未保存草稿不能导出官方主题")
            return nil
        }

        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let exported = try await connected.codexOfficialTheme(for: profile)
            guard exported.ok,
                  exported.targetClientId == ClientID.codex.rawValue,
                  exported.profileId == profile.id,
                  exported.format == "codex-theme-v1",
                  exported.manualImport,
                  exported.themeString.hasPrefix("codex-theme-v1:") else {
                errorMessage = LingGlowL10n.string("本地服务返回的 Codex 官方主题不完整")
                return nil
            }
            successMessage = LingGlowL10n.string("已生成 Codex 官方主题；请在 Codex 中手动导入")
            return exported
        } catch {
            report(error)
            return nil
        }
    }

    /// A design-only draft may become an executable profile only through the
    /// backend's reviewed promotion endpoint. Promotion never creates an apply
    /// intent, launches a target, or changes a schedule.
    func promoteUnionProfileDraft(_ profile: UnionProfile) async -> UnionProfile? {
        guard !isBusy else { return nil }
        guard isUnionProfileDraft(profile) else {
            errorMessage = LingGlowL10n.string("只能提升已保存的不可执行设计草稿")
            return nil
        }
        guard canPersistCustomProfile(id: profile.id) else {
            errorMessage = LingGlowL10n.string("提升设计草稿需要有效 VIP 或与此 profileId 绑定的自定义位授权")
            return nil
        }
        guard let client = ClientID(rawValue: profile.targetClientId) else {
            errorMessage = LingGlowL10n.string("设计草稿的目标 Agent 无效")
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let schema: CapabilitySchemaResponse
            if let cached = capabilitySchemas[client] {
                schema = cached
            } else {
                schema = try await connected.capabilitySchema(for: client)
                capabilitySchemas[client] = schema
            }
            guard schema.capabilityMap.runtimeStatus == "available" else {
                errorMessage = LingGlowL10n.string("%@ 尚未完成运行时适配；设计草稿不能提升为可执行皮肤", client.displayName)
                return nil
            }
            let promoted = try await connected.promoteUnionProfileDraft(profile).profile
            unionProfileDrafts.removeAll { $0.id == promoted.id }
            unionProfiles.removeAll { $0.id == promoted.id }
            unionProfiles.insert(promoted, at: 0)
            successMessage = LingGlowL10n.string("已提升「%@」为可执行皮肤；尚未应用", promoted.name)
            return promoted
        } catch {
            report(error)
            return nil
        }
    }

    func createApplyIntent(for profile: UnionProfile) async -> ApplyIntent? {
        guard !isBusy else { return nil }
        guard !isUnionProfileDraft(profile) else {
            errorMessage = LingGlowL10n.string("不可执行设计草稿不能应用；请等待目标 Agent 完成运行时适配后再显式提升")
            return nil
        }
        guard canPersistCustomProfile(id: profile.id) else {
            errorMessage = LingGlowL10n.string("免费用户只能预览；应用需要有效 VIP 或与此 profileId 绑定的自定义位授权")
            return nil
        }
        guard let client = ClientID(rawValue: profile.targetClientId) else {
            errorMessage = LingGlowL10n.string("自定义皮肤的目标 Agent 无效")
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            return try await connected.createIntent(
                client: client,
                skinId: profile.id,
                operation: "apply"
            ).intent
        } catch {
            report(error)
            return nil
        }
    }

    func saveFreeBrand(
        displayName: String?,
        tagline: String?,
        iconImage: String?,
        composerAvatarImage: String?,
        composerAvatarMotion: String?,
        codexHomeTitle: String?,
        doubaoHomeTitle: String?,
        workbuddyHomeTitle: String?
    ) async -> Bool {
        guard !isBusy else { return false }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let value = try await connected.saveFreeBrand(
                displayName: displayName,
                tagline: tagline,
                iconImage: iconImage,
                composerAvatarImage: composerAvatarImage,
                composerAvatarMotion: composerAvatarMotion,
                codexHomeTitle: codexHomeTitle,
                doubaoHomeTitle: doubaoHomeTitle,
                workbuddyHomeTitle: workbuddyHomeTitle
            ).freeBrand
            freeBrand = value
            if value.displayName == nil && value.tagline == nil && value.iconImage == nil &&
                value.composerAvatarImage == nil && value.composerAvatarMotion == nil &&
                value.codexHomeTitle == nil &&
                value.doubaoHomeTitle == nil && value.workbuddyHomeTitle == nil {
                successMessage = LingGlowL10n.string("已清除免费外观覆盖；重新应用后恢复当前皮肤默认值")
            } else {
                successMessage = LingGlowL10n.string("免费 Icon、机器人与首页文案已保存；重新应用对应皮肤后生效")
            }
            return true
        } catch {
            report(error)
            return false
        }
    }

    func confirm(_ intent: ApplyIntent) async {
        guard !isBusy else { return }
        isBusy = true
        clearMessages()
        do {
            let connected = try await connectedAPI()
            let operation: String
            if intent.summary.operation == "apply",
               let client = ClientID(rawValue: intent.summary.clientId),
               !intent.summary.skinId.isEmpty {
                try await confirmApplyWithRecovery(
                    connected,
                    intent: intent,
                    client: client,
                    skinId: intent.summary.skinId
                )
                operation = "apply"
            } else {
                operation = try await connected.confirm(intent: intent).operation
            }
            let refreshed = try await connectedAPI()
            let freshStatus = try await refreshed.status()
            try verifyIdentity(freshStatus, api: refreshed)
            acceptStatus(freshStatus)
            successMessage = LingGlowL10n.string(operation == "restore" ? "已恢复官方原版" : "皮肤已应用")
        } catch {
            report(error)
        }
        isBusy = false
    }

    @discardableResult
    func activateLicense() async -> Bool {
        await activateLicense(code: licenseInput, context: .general) != nil
    }

    /// Activates a license from either the general authorization page or a
    /// specific locked skin card. The first trusted request never contains a
    /// skin ID. Only a Dodo-backed SELECTION_REQUIRED response allows the
    /// current card's exact skin ID to be confirmed and submitted.
    @discardableResult
    func activateLicense(
        code rawCode: String,
        context: LicenseActivationContext
    ) async -> LicenseActivationPurpose? {
        let code = rawCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            errorMessage = LingGlowL10n.string("请先粘贴授权码")
            return nil
        }
        guard code.utf8.count <= 1_024 else {
            errorMessage = LingGlowL10n.string("授权码长度无效")
            return nil
        }
        if redemptionSkinSelectionRequired && selectionRequiredLicenseInput != code {
            redemptionSkinSelectionRequired = false
            selectionRequiredLicenseInput = nil
        }
        guard !isBusy else { return nil }

        let previousEntitlement = entitlement
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            do {
                // This first attempt is intentionally context-free. The
                // client must not turn an unrelated VIP/custom code into a
                // single-skin redemption merely because a card was open.
                let response = try await connected.activateLicense(code, skinId: nil)
                return completeLicenseActivation(response, previous: previousEntitlement)
            } catch let NativeStudioError.api(_, message, errorCode) {
                guard errorCode == "SELECTION_REQUIRED" else {
                    errorMessage = LingGlowL10n.string(message)
                    return nil
                }

                guard case let .skin(preferredSkin) = context else {
                    licenseInput = code
                    redemptionSkinSelectionRequired = true
                    selectionRequiredLicenseInput = code
                    errorMessage = LingGlowL10n.string(context.isCustomSlot
                        ? "这是单套皮肤授权码，不是自定义皮肤位授权码。请到皮肤页选择要永久绑定的皮肤。"
                        : "这是单套皮肤授权码。请回到皮肤页，在要解锁的皮肤卡片上点击“解锁”。")
                    return nil
                }

                // The published redemption catalog is the trust boundary for
                // an immutable skin binding; a visible card alone is not. The
                // first context-free request awaited the remote redemption
                // catalog on the service, so refresh the native snapshot now
                // before rejecting a newly downloaded card as absent.
                await loadProductCatalogIfNeeded(force: true)
                guard let permanentSkin = redemptionSkins.first(where: { $0.id == preferredSkin.id }) else {
                    errorMessage = LingGlowL10n.string("当前皮肤不在可信单套授权目录中，暂时不能完成兑换。")
                    return nil
                }
                guard presentPermanentSkinRedemptionConfirmation(permanentSkin) else {
                    return nil
                }

                do {
                    let response = try await connected.activateLicense(code, skinId: permanentSkin.id)
                    return completeLicenseActivation(response, previous: previousEntitlement)
                } catch let NativeStudioError.api(_, secondMessage, _) {
                    errorMessage = LingGlowL10n.string(secondMessage)
                    return nil
                } catch {
                    report(error)
                    return nil
                }
            }
        } catch {
            report(error)
            return nil
        }
    }

    private func completeLicenseActivation(
        _ response: EntitlementResponse,
        previous: EntitlementInfo?
    ) -> LicenseActivationPurpose {
        updateEntitlement(response.entitlement)
        licenseInput = ""
        redemptionSkinSelectionRequired = false
        selectionRequiredLicenseInput = nil
        successMessage = LingGlowL10n.string("授权码已验证，权益状态已同步")
        return activationPurpose(in: response.entitlement, previous: previous)
    }

    private func activationPurpose(
        in current: EntitlementInfo,
        previous: EntitlementInfo?
    ) -> LicenseActivationPurpose {
        if current.isVIP && previous?.isVIP != true { return .vip }

        let newSkinIds = current.purchasedSkinIds.subtracting(previous?.purchasedSkinIds ?? [])
        if let skinId = newSkinIds.sorted().first { return .skin(skinId) }

        let newProfileIds = current.unlockedCustomProfileIds.subtracting(previous?.unlockedCustomProfileIds ?? [])
        if let profileId = newProfileIds.sorted().first { return .customProfile(profileId) }

        let activeGrants = current.license?.grants?.filter { $0.status == "active" } ?? []
        if activeGrants.contains(where: { $0.offerType == "vip_subscription" }) { return .vip }
        if let skinId = activeGrants.compactMap({ grant in
            grant.offerType == "skin_once" ? grant.binding?.skinId : nil
        }).first {
            return .skin(skinId)
        }
        if let profileId = activeGrants.compactMap({ grant in
            grant.offerType == "custom_slot_once" ? grant.binding?.profileId : nil
        }).first {
            return .customProfile(profileId)
        }
        return .unknown
    }

    func refreshLicense() async {
        guard !isBusy else { return }
        isBusy = true
        clearMessages()
        do {
            let connected = try await connectedAPI()
            let response = try await connected.refreshLicense()
            updateEntitlement(response.entitlement)
            successMessage = LingGlowL10n.string("权益租约已通过可信服务刷新")
        } catch {
            report(error)
        }
        isBusy = false
    }

    func deactivateLicense() async {
        guard !isBusy else { return }
        isBusy = true
        clearMessages()
        do {
            let connected = try await connectedAPI()
            let response = try await connected.deactivateLicense()
            updateEntitlement(response.entitlement)
            licenseInput = ""
            redemptionSkinSelectionRequired = false
            selectionRequiredLicenseInput = nil
            successMessage = LingGlowL10n.string("这台 Mac 的授权已停用；服务端永久绑定关系没有改变")
        } catch {
            report(error)
        }
        isBusy = false
    }

    func removeLicense() async {
        guard !isBusy else { return }
        isBusy = true
        clearMessages()
        do {
            let connected = try await connectedAPI()
            let response = try await connected.removeLicense()
            updateEntitlement(response.entitlement)
            licenseInput = ""
            redemptionSkinSelectionRequired = false
            selectionRequiredLicenseInput = nil
            successMessage = LingGlowL10n.string("已移除本机授权缓存；服务端永久绑定关系不会改变")
        } catch {
            report(error)
        }
        isBusy = false
    }

    func toggleLoginAgent() async {
        guard let loginAgent = status?.loginAgent, !isBusy else { return }
        if !loginAgent.managed && !isVIP {
            errorMessage = LingGlowL10n.string("随登录启动排程提醒需要有效 VIP")
            return
        }
        if loginAgent.installed && !loginAgent.managed {
            errorMessage = LingGlowL10n.string("检测到非灵妆管理的同名登录项，未做修改")
            return
        }

        isBusy = true
        clearMessages()
        do {
            let connected = try await connectedAPI()
            let response = try await connected.updateLoginAgent(
                action: loginAgent.managed ? "remove" : "install"
            )
            updateLoginAgent(response.loginAgent)
            successMessage = LingGlowL10n.string(response.loginAgent.managed
                ? "登录提醒已开启，下次登录时生效"
                : "登录提醒已关闭")
        } catch {
            report(error)
        }
        isBusy = false
    }

    func setScheduleEnabled(_ enabled: Bool) {
        guard var value = schedule else { return }
        value.enabled = enabled
        schedule = value
    }

    func setScheduleReminders(_ enabled: Bool) {
        guard var value = schedule else { return }
        value.remindOnLaunch = enabled
        schedule = value
    }

    func setScheduleTimeZone(_ identifier: String) {
        guard var value = schedule else { return }
        value.timeZone = identifier
        schedule = value
    }

    func scheduledSkin(for client: ClientID, day: Weekday) -> String? {
        schedule?.clients.assignments(for: client).value(for: day)
    }

    func setScheduledSkin(_ skinId: String?, for client: ClientID, day: Weekday) {
        guard var value = schedule else { return }
        var assignments = value.clients.assignments(for: client)
        assignments.set(skinId, for: day)
        value.clients.set(assignments, for: client)
        schedule = value
    }

    func saveSchedule() async {
        guard let value = schedule else { return }
        guard isVIP else {
            errorMessage = LingGlowL10n.string("保存七日排程需要有效 VIP")
            return
        }
        guard TimeZone(identifier: value.timeZone) != nil else {
            errorMessage = LingGlowL10n.string("请选择系统支持的时区")
            return
        }
        guard !isBusy else { return }
        isBusy = true
        clearMessages()
        do {
            let connected = try await connectedAPI()
            let response = try await connected.saveSchedule(value)
            schedule = response.schedule
            successMessage = LingGlowL10n.string("七日排程已保存")
        } catch {
            report(error)
        }
        isBusy = false
    }

    func consumeReminder(_ reminder: ScheduleReminder, action: String) async -> ApplyIntent? {
        pendingReminder = nil
        guard let client = ClientID(rawValue: reminder.clientId) else { return nil }
        guard !isBusy else {
            // A reminder decision is an explicit user action and must never be
            // dropped: let the next status refresh present this reminder again
            // once the model is idle.
            lastPresentedReminderKey = nil
            return nil
        }
        isBusy = true
        clearMessages()
        defer { isBusy = false }
        do {
            let connected = try await connectedAPI()
            let decision = try await connected.decideReminder(
                reminder,
                action: action,
                minutes: action == "snooze" ? 60 : nil
            )
            if action == "snooze" {
                successMessage = LingGlowL10n.string("一小时后再提醒")
                return nil
            }
            if action == "skip" {
                successMessage = LingGlowL10n.string("今天不会再提醒")
                return nil
            }
            selectedClient = client
            // A current local host returns a prepared one-time intent and
            // deliberately leaves the reminder unclaimed until `confirm` has
            // restarted the target successfully.  Older hosts return only a
            // skin ID, so retain the narrow compatibility fallback.
            if let intent = decision.intent {
                return intent
            }
            return try await connected.createIntent(
                client: client,
                skinId: decision.skinId,
                operation: "apply"
            ).intent
        } catch {
            report(error)
            return nil
        }
    }

    func clearMessages() {
        errorMessage = nil
        successMessage = nil
        errorIsConnectionFailure = false
    }

    private func connectedAPI() async throws -> LocalAPI {
        if let current = api, current.matchesCurrentSessionManifest() {
            do {
                let liveStatus = try await current.status()
                try verifyIdentity(liveStatus, api: current)
                acceptStatus(liveStatus)
                connectionState = .connected
                clearRecoveredConnectionError()
                return current
            } catch {
                guard isConnectionFailure(error) else { throw error }
                api = nil
            }
        } else {
            api = nil
        }
        let connected = try await bootstrapper.ensureRunning()
        let liveStatus = try await connected.status()
        try verifyIdentity(liveStatus, api: connected)
        api = connected
        acceptStatus(liveStatus)
        connectionState = .connected
        clearRecoveredConnectionError()
        return connected
    }

    @discardableResult
    private func startProductCatalogLoad(
        using connected: LocalAPI? = nil,
        force: Bool = false
    ) -> Task<Void, Never>? {
        if let productCatalogTask { return productCatalogTask }
        guard force || productCatalog == nil else { return nil }
        isProductCatalogLoading = true
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                self.isProductCatalogLoading = false
                self.productCatalogTask = nil
            }
            do {
                let api: LocalAPI
                if let connected {
                    api = connected
                } else {
                    api = try await self.connectedAPI()
                }
                let catalog = try await api.products()
                self.productCatalog = catalog
                self.productCatalogError = nil
            } catch {
                if self.productCatalog == nil {
                    self.productCatalogError = self.displayMessage(for: error)
                }
            }
        }
        productCatalogTask = task
        return task
    }

    private func loadCatalogs(
        using connected: LocalAPI,
        manuallySyncingTemplates: Bool = false
    ) async throws {
        var loadedCatalogs: [ClientID: [CatalogSkin]] = [:]
        for (index, client) in ClientID.allCases.enumerated() {
            do {
                loadedCatalogs[client] = try await connected.catalog(
                    for: client,
                    // All clients share one verified remote index. Force just
                    // the first request; the remaining two read the newly
                    // written cache instead of issuing duplicate GitHub calls.
                    manuallySyncingTemplates: manuallySyncingTemplates && index == 0
                ).skins
            } catch where client == .doubao {
                // Some compatible local hosts expose Doubao status and schema
                // before they expose a catalog route. Treat that as an honest
                // empty catalog without hiding the other two clients.
                loadedCatalogs[client] = []
            }
        }
        catalogs = loadedCatalogs
    }

    private func loadSnapshot(using connected: LocalAPI) async throws {
        let newStatus = try await connected.status()
        try verifyIdentity(newStatus, api: connected)
        // Publish lightweight state first. The scheduler must stay usable while
        // the larger gallery catalog refreshes in the background.
        acceptStatus(newStatus)
        // Product cards are independent of the large skin catalog. Start them
        // immediately and never hold the rest of the window snapshot open.
        _ = startProductCatalogLoad(using: connected)
        let scheduleResponse = try await connected.schedule()
        schedule = scheduleResponse.schedule
        try await loadCatalogs(using: connected)
        let profileResponse = try await connected.profiles()
        let freeBrandResponse = try await connected.freeBrand()
        profiles = profileResponse.profiles
        freeBrand = freeBrandResponse.freeBrand

        do {
            unionProfiles = try await connected.unionProfiles().profiles
        } catch {
            // Legacy local services may not expose union profiles yet. Keep the
            // rest of the native client usable and surface the error only when
            // the custom editor is opened.
            unionProfiles = []
        }
        do {
            // Keep drafts separate from `unionProfiles`: only the latter can
            // ever be resolved by the backend into an executable skin.
            unionProfileDrafts = try await connected.unionProfileDrafts().profiles
        } catch {
            // The native menu bar remains usable against an older local host;
            // an entitled blocked-Agent user will see the precise error when
            // they attempt to open or save a design draft.
            unionProfileDrafts = []
        }
    }

    private func refreshStatusSilently() async {
        do {
            let needsFullSnapshot = api == nil || connectionState != .connected
            let connected = try await connectedAPI()
            if needsFullSnapshot {
                try await loadSnapshot(using: connected)
            } else {
                let freshStatus = try await connected.status()
                try verifyIdentity(freshStatus, api: connected)
                acceptStatus(freshStatus)
                if productCatalog == nil {
                    _ = startProductCatalogLoad(using: connected)
                }
            }
            connectionState = .connected
            clearRecoveredConnectionError()
        } catch {
            api = nil
            registerConnectionFailure(error, showMessage: consecutiveConnectionFailures >= 2)
        }
    }

    private func verifyIdentity(_ response: StudioStatusResponse, api: LocalAPI) throws {
        guard response.studio.instanceId == api.lock.instanceId else {
            throw NativeStudioError.unsafeSession("本地服务实例与会话文件不一致")
        }
    }

    private func acceptStatus(_ value: StudioStatusResponse) {
        status = value
        if let reminder = value.reminders.first {
            if lastPresentedReminderKey != reminder.id {
                lastPresentedReminderKey = reminder.id
                pendingReminder = reminder
            }
        } else {
            lastPresentedReminderKey = nil
            pendingReminder = nil
        }
    }

    private func updateEntitlement(_ entitlement: EntitlementInfo) {
        guard let value = status else { return }
        status = StudioStatusResponse(
            ok: value.ok,
            studio: value.studio,
            clients: value.clients,
            entitlement: entitlement,
            loginAgent: value.loginAgent,
            reminders: value.reminders
        )
    }

    private func updateLoginAgent(_ loginAgent: LoginAgentStatus) {
        guard let value = status else { return }
        status = StudioStatusResponse(
            ok: value.ok,
            studio: value.studio,
            clients: value.clients,
            entitlement: value.entitlement,
            loginAgent: loginAgent,
            reminders: value.reminders
        )
    }

    private func report(_ error: Error) {
        if isConnectionFailure(error) {
            registerConnectionFailure(error, showMessage: true)
            return
        }
        errorMessage = displayMessage(for: error)
        errorIsConnectionFailure = false
    }

    private func registerConnectionFailure(_ error: Error, showMessage: Bool) {
        guard isConnectionFailure(error) else {
            connectionState = .disconnected
            errorMessage = displayMessage(for: error)
            errorIsConnectionFailure = false
            return
        }
        api = nil
        consecutiveConnectionFailures += 1
        connectionState = .starting
        errorIsConnectionFailure = true
        if showMessage {
            errorMessage = LingGlowL10n.string("灵妆内置功能正在自动恢复，无需手动连接；请稍候。")
        }
    }

    private func clearRecoveredConnectionError() {
        consecutiveConnectionFailures = 0
        guard errorIsConnectionFailure else { return }
        errorMessage = nil
        errorIsConnectionFailure = false
    }

    private func isConnectionFailure(_ error: Error) -> Bool {
        guard let nativeError = error as? NativeStudioError else { return false }
        switch nativeError {
        case .backendUnavailable(let message):
            return message == "无法连接本机灵妆服务" ||
                message.contains("本地服务尚未就绪") ||
                message.contains("本地服务进程已经结束") ||
                message.contains("内置服务")
        case .foreignRuntimeConflict, .unsafeSession:
            return true
        case .invalidResponse, .api:
            return false
        }
    }

    private func displayMessage(for error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription {
            return LingGlowL10n.string(description)
        }
        return LingGlowL10n.string("操作失败，请稍后重试")
    }
}

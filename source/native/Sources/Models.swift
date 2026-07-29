import Foundation

// `ClientID` is generated from src/client-registry.mjs at build time.  It is
// intentionally not declared here: a new Agent must not require a second,
// independently maintained Swift client list.

enum StudioTab: String, CaseIterable, Identifiable {
    case skins
    case custom
    case schedule
    case account
    case support
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .skins: return LingGlowL10n.string("皮肤")
        case .custom: return LingGlowL10n.string("创作")
        case .schedule: return LingGlowL10n.string("排程")
        case .account: return LingGlowL10n.string("授权")
        case .support: return LingGlowL10n.string("咨询")
        case .settings: return LingGlowL10n.string("设置")
        }
    }
}

enum SkinLabelCategory: String, CaseIterable, Identifiable, Codable {
    case basketball
    case football
    case filmIP = "film-ip"
    case animeIP = "anime-ip"
    case novelIP = "novel-ip"
    case gameIP = "game-ip"
    case celebrity
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .basketball: return LingGlowL10n.string("篮球")
        case .football: return LingGlowL10n.string("足球")
        case .filmIP: return LingGlowL10n.string("影视同名")
        case .animeIP: return LingGlowL10n.string("动漫同名")
        case .novelIP: return LingGlowL10n.string("小说同名")
        case .gameIP: return LingGlowL10n.string("游戏同名")
        case .celebrity: return LingGlowL10n.string("明星")
        case .other: return LingGlowL10n.string("其它")
        }
    }
}

enum Weekday: String, CaseIterable, Identifiable, Codable {
    case monday, tuesday, wednesday, thursday, friday, saturday, sunday

    var id: String { rawValue }

    var shortName: String {
        switch self {
        case .monday: return LingGlowL10n.string("周一")
        case .tuesday: return LingGlowL10n.string("周二")
        case .wednesday: return LingGlowL10n.string("周三")
        case .thursday: return LingGlowL10n.string("周四")
        case .friday: return LingGlowL10n.string("周五")
        case .saturday: return LingGlowL10n.string("周六")
        case .sunday: return LingGlowL10n.string("周日")
        }
    }
}

struct SessionLock: Decodable {
    let schemaVersion: Int
    let pid: Int32
    let instanceId: String
    let host: String
    let port: Int
    let token: String
    /// Older local backends have no runtime identity. Keeping this optional
    /// lets the bootstrapper identify them and fail closed rather than attach.
    let runtimeIdentity: String?
    let startedAt: String
}

struct StudioInfo: Decodable {
    let version: String
    let transportPreference: String
    let instanceId: String
    let runtimeIdentity: String?
}

struct CompatibilityInfo: Decodable {
    let level: String
    let advancedAllowed: Bool
    let reason: String?

    var displayLevel: String {
        switch level {
        case "exact": return LingGlowL10n.string("精确适配")
        case "generic-safe": return LingGlowL10n.string("基础适配")
        default: return LingGlowL10n.string("安全检查未通过")
        }
    }
}

struct SkinSessionStatus: Decodable {
    let state: String
    let mode: String?
    let pid: Int32?
    let profileId: String?
    let clientId: String
    let injectedTargets: Int
    let lastError: String?
}

struct ClientStatus: Decodable {
    let clientId: String
    let displayName: String
    let installed: Bool
    let version: String?
    let running: Bool
    let signatureValid: Bool
    let trustedPublisher: Bool
    let compatibility: CompatibilityInfo
    /// This is the server's *effective* runtime capability intersection, not
    /// the broader Union schema.  Catalog cards must use it when describing
    /// what a Theme Pack will actually change for the currently detected
    /// Agent version.
    let capabilities: [String]?
    let session: SkinSessionStatus
}

struct LicenseInfo: Decodable {
    let schemaVersion: Int?
    let licenseId: String
    let subject: String
    let expiresAt: String?
    let clientIds: [String]
    let grants: [LicenseGrantInfo]?
}

struct LicenseGrantBinding: Decodable {
    let skinId: String?
    let profileId: String?
}

struct LicenseGrantInfo: Decodable, Identifiable {
    let grantId: String
    let offerType: String
    let status: String
    let productId: String
    let binding: LicenseGrantBinding?
    let boundAt: String
    let validUntil: String?
    let revokedAt: String?

    var id: String { grantId }
}

/// The first-use VIP window is generated and persisted locally by the signed
/// LingGlow runtime. It is deliberately separate from `LicenseInfo`: a trial
/// never represents a Dodo subscription, a license key, or a paid grant.
struct LocalVipTrialInfo: Decodable {
    let kind: String
    let state: String
    let startedAt: String
    let expiresAt: String
    let remainingSeconds: Int
    let durationDays: Int

    var isActive: Bool { kind == "local-first-use" && state == "active" && remainingSeconds > 0 }
    var isExpired: Bool { kind == "local-first-use" && state == "expired" }

    var remainingDisplay: String {
        let total = max(0, remainingSeconds)
        if total == 0 { return LingGlowL10n.string("已结束") }
        let days = total / 86_400
        let hours = (total % 86_400) / 3_600
        let minutes = (total % 3_600) / 60
        if days > 0 { return LingGlowL10n.string("%lld 天 %lld 小时", days, hours) }
        if hours > 0 { return LingGlowL10n.string("%lld 小时 %lld 分钟", hours, minutes) }
        return LingGlowL10n.string("%lld 分钟", max(1, minutes))
    }

    var expiryDisplay: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: expiresAt) else { return expiresAt }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }
}

struct EntitlementInfo: Decodable {
    let tier: String
    let source: String
    let status: String
    let reason: String?
    let license: LicenseInfo?
    let issuerConfigured: Bool
    let activationConfigured: Bool?
    let refreshConfigured: Bool?
    let deactivationConfigured: Bool?
    let rawLicenseStorage: String?
    let skinIds: [String]?
    let customProfileIds: [String]?
    let trial: LocalVipTrialInfo?

    var isVIP: Bool { tier == "vip" }
    var purchasedSkinIds: Set<String> { Set(skinIds ?? []) }
    var unlockedCustomProfileIds: Set<String> { Set(customProfileIds ?? []) }
}

struct LoginAgentStatus: Decodable {
    let label: String
    let agentPath: String?
    let packageRoot: String?
    let installed: Bool
    let managed: Bool
    let state: String
    let reason: String?
}

struct ScheduleReminder: Decodable, Equatable, Identifiable {
    let clientId: String
    let clientName: String
    let skinId: String
    let skinName: String
    let dateKey: String

    var id: String { "\(clientId):\(dateKey):\(skinId)" }
}

struct StudioStatusResponse: Decodable {
    let ok: Bool
    let studio: StudioInfo
    let clients: [String: ClientStatus]
    let entitlement: EntitlementInfo
    let loginAgent: LoginAgentStatus
    let reminders: [ScheduleReminder]
}

struct SkinPreview: Decodable {
    let gradientPreset: String
}

struct SkinColors: Decodable {
    let accent: String
    let surface: String
    let ink: String
}

struct CatalogSkin: Decodable, Identifiable {
    let schemaVersion: Int
    let id: String
    let name: String
    let description: String
    let tier: String
    let clientIds: [String]
    let category: String?
    let labelCategory: String?
    let series: String?
    let tags: [String]?
    let preview: SkinPreview
    let colors: SkinColors
    let previewArtwork: String?
    let previewArtworkURL: String?
    let hasArtwork: Bool?
    let hasProjectHero: Bool?
    let hasComposerAvatar: Bool?
    let hasBrand: Bool?
    let hasBanner: Bool?
    let runtimeStatus: String?
    let applySupported: Bool?
    let designPreview: Bool?
    let installed: Bool?
    let updateAvailable: Bool?
    let packageVersion: String?
    let publishedAt: String?
    let downloadBytes: Int?
    let distribution: String?
    let vipTrialState: String?

    var isVIP: Bool { tier == "vip" }
    var includesBundledArtwork: Bool { hasArtwork == true }
    var includesProjectHero: Bool { hasProjectHero == true }
    var includesComposerAvatar: Bool { hasComposerAvatar == true }
    var includesCustomBrand: Bool { hasBrand == true }
    var includesBanner: Bool { hasBanner == true }
    /// A blocked client can still show local Theme Pack art, but it must never
    /// be described as an applicable runtime skin.
    var isDesignPreviewOnly: Bool { designPreview == true || runtimeStatus == "blocked" }
    var isInstalled: Bool { installed != false }
    var needsDownloadOrUpdate: Bool { !isInstalled || updateAvailable == true }
    var isOwned: Bool { !isVIP || vipTrialState == "owned" }
}

struct CatalogResponse: Decodable {
    let ok: Bool
    let clientId: String
    let skins: [CatalogSkin]
}

struct RemoteSkinReceipt: Decodable {
    let id: String
    let kind: String
    let version: String
    let packageSHA256: String
    let installedAt: String
}

struct RemoteSkinInstallResponse: Decodable {
    let ok: Bool
    let clientId: String
    let receipt: RemoteSkinReceipt
    let skins: [CatalogSkin]
}

/// A skin that the current entitlement can actually place into a seven-day
/// schedule.  This is deliberately separate from `CatalogSkin`: a schedule
/// can also reference a persisted custom profile, which has no catalog card.
struct ScheduleSkinOption: Identifiable {
    let id: String
    let name: String
    let isVIP: Bool
    let isCustom: Bool

    var menuLabel: String {
        if isCustom { return LingGlowL10n.string("%@ · 自定义", name) }
        if isVIP { return "\(name) · VIP" }
        return name
    }
}

struct CommerceReadiness: Decodable {
    let status: String
    let configured: Bool
    let environment: String?
    let productDirectoryEnvironment: String?
    let checkoutEnabled: Bool
    let redemptionEnabled: Bool
    let refreshEnabled: Bool?
    let deactivationEnabled: Bool?
    let portalConfigured: Bool?
    let releaseConfigVerified: Bool?
    let leaseVerifierConfigured: Bool?
    let keychainAvailable: Bool?
    let secretStorage: String?
    let reasonCode: String?
    let configId: String?
    let configExpiresAt: String?

    var usesTestProductDirectory: Bool {
        environment == "test"
            || productDirectoryEnvironment == "test_mode"
            || status == "test"
            || status == "test-configured"
    }

    var unavailableReason: String {
        if usesTestProductDirectory || reasonCode == "TEST_MODE_NOT_FOR_SALE" {
            return LingGlowL10n.string("当前四个 Dodo Product ID 均属于测试环境，正式购买尚未开放")
        }
        if reasonCode == "DODO_LIVE_PRODUCT_IDS_REQUIRED" {
            return LingGlowL10n.string("当前 Product ID 仅属于 Dodo 测试环境，正式购买尚未开放")
        }
        if reasonCode == "KEYCHAIN_UNAVAILABLE" {
            return LingGlowL10n.string("macOS 系统钥匙串不可用，购买与兑换已安全停用")
        }
        if reasonCode == "RELEASE_CONFIG_SIGNATURE_INVALID" {
            return LingGlowL10n.string("发行配置签名无效，购买入口已安全停用")
        }
        if !configured || !checkoutEnabled {
            return reasonCode == "TRUSTED_COMMERCE_UNCONFIGURED"
                ? LingGlowL10n.string("Dodo Payments 可信支付服务尚未配置")
                : LingGlowL10n.string("可信支付服务当前不可用")
        }
        return LingGlowL10n.string("本地宿主尚未返回可认证的结算链接")
    }
}

struct ProductBilling: Decodable {
    let kind: String
    let interval: String?
}

struct ProductBinding: Decodable {
    let kind: String
    let immutable: Bool
    let selection: String
}

struct ProductCatalogItem: Decodable, Identifiable {
    let id: String
    let dodoProductId: String
    let offerType: String
    let name: String
    let summary: String
    let billing: ProductBilling
    let binding: ProductBinding
    let features: [String]
    let checkoutUrl: String?
    let purchaseUrl: String?

    var safeCheckoutURL: URL? {
        for candidate in [checkoutUrl, purchaseUrl].compactMap({ $0 }) {
            guard let url = URL(string: candidate),
                  url.scheme == "https",
                  url.user == nil,
                  url.password == nil,
                  url.host == "checkout.dodopayments.com" else { continue }
            return url
        }
        return nil
    }
}

struct RedemptionSkin: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let tier: String
}

struct ProductCatalogResponse: Decodable {
    let ok: Bool
    let schemaVersion: Int
    let provider: String
    let commerce: CommerceReadiness
    let products: [ProductCatalogItem]
    let redemptionSkins: [RedemptionSkin]?
}

private struct DynamicCodingKey: CodingKey, Hashable {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

enum JSONValue: Codable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: LingGlowL10n.string("未知 JSON 值"))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var boolValue: Bool? {
        guard case .bool(let value) = self else { return nil }
        return value
    }

    var numberValue: Double? {
        guard case .number(let value) = self else { return nil }
        return value
    }

    var arrayValue: [JSONValue]? {
        guard case .array(let value) = self else { return nil }
        return value
    }
}

struct CapabilityEditorField: Decodable, Identifiable {
    let id: String
    let type: String
    let defaultValue: JSONValue
    let assetSlot: String?
    let status: String
    let description: String
    let group: String
    let constraints: [String: JSONValue]
    let value: JSONValue
    let supportStatus: String
    let supportDescription: String
    let editable: Bool

    var optionValues: [String] {
        constraints["options"]?.arrayValue?.compactMap(\.stringValue) ?? []
    }

    var minimum: Double? { constraints["min"]?.numberValue }
    var maximum: Double? { constraints["max"]?.numberValue }
}

struct CapabilityEditorProjection: Decodable {
    let profileId: String?
    let targetClientId: String
    let fields: [CapabilityEditorField]
}

/// Full-union metadata is returned alongside the target editor projection.
/// The native editor uses it when creating a profile so hidden fields remain
/// explicit defaults instead of disappearing when a user later changes Agent.
struct CapabilityUnionField: Decodable, Identifiable {
    let id: String
    let defaultValue: JSONValue
}

struct CapabilityMapInfo: Decodable {
    let runtimeStatus: String
    let transportVerified: Bool
    let auditedTarget: String
}

struct CapabilitySchemaResponse: Decodable {
    let ok: Bool
    let schemaVersion: Int
    let clientIds: [String]
    let clientId: String
    let fields: [CapabilityUnionField]?
    let capabilityMap: CapabilityMapInfo
    let editorProjection: CapabilityEditorProjection
}

struct UnionProfile: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var targetClientId: String
    var schemaVersion: Int
    var values: [String: JSONValue]
    var extra: [String: JSONValue]

    init(
        id: String,
        name: String,
        targetClientId: String,
        schemaVersion: Int,
        values: [String: JSONValue],
        extra: [String: JSONValue] = [:]
    ) {
        self.id = id
        self.name = name
        self.targetClientId = targetClientId
        self.schemaVersion = schemaVersion
        self.values = values
        self.extra = extra
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        var raw: [String: JSONValue] = [:]
        for key in container.allKeys {
            raw[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
        }
        guard case .string(let id)? = raw.removeValue(forKey: "id"),
              case .string(let name)? = raw.removeValue(forKey: "name"),
              case .string(let targetClientId)? = raw.removeValue(forKey: "targetClientId"),
              case .number(let schemaNumber)? = raw.removeValue(forKey: "schemaVersion"),
              case .object(let values)? = raw.removeValue(forKey: "values") else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: LingGlowL10n.string("并集皮肤缺少必要字段"))
            )
        }
        self.id = id
        self.name = name
        self.targetClientId = targetClientId
        self.schemaVersion = Int(schemaNumber)
        self.values = values
        self.extra = raw
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        var raw = extra
        raw["id"] = .string(id)
        raw["name"] = .string(name)
        raw["targetClientId"] = .string(targetClientId)
        raw["schemaVersion"] = .number(Double(schemaVersion))
        raw["values"] = .object(values)
        for (key, value) in raw {
            guard let codingKey = DynamicCodingKey(stringValue: key) else { continue }
            try container.encode(value, forKey: codingKey)
        }
    }
}

struct UnionProfilesResponse: Decodable {
    let ok: Bool
    let profiles: [UnionProfile]
}

struct UnionProfileResponse: Decodable {
    let ok: Bool
    let profile: UnionProfile
}

/// A public `codex-theme-v1:` payload generated from an already persisted
/// Codex union profile. It is deliberately a text-export response, not an
/// apply/restart/session command: the user imports the copied string in
/// Codex's own Appearance settings.
struct CodexOfficialThemeExportResponse: Decodable {
    let ok: Bool
    let profileId: String
    let profileName: String
    let targetClientId: String
    let format: String
    let themeString: String
    let manualImport: Bool
    let includedFieldIds: [String]
    let deferredFieldIds: [String]
    let instructions: [String]
}

struct SkinProfileFonts: Codable {
    var code: String?
    var ui: String?
}

struct SkinProfileSemanticColors: Codable {
    var diffAdded: String
    var diffRemoved: String
    var skill: String
}

struct SkinProfileOfficial: Codable {
    var variant: String
    var codeThemeId: String
    var accent: String
    var surface: String
    var ink: String
    var contrast: Int
    var fonts: SkinProfileFonts
    var opaqueWindows: Bool
    var semanticColors: SkinProfileSemanticColors
}

struct SkinProfileBackground: Codable {
    var image: String?
    var opacity: Double
    var overlay: Double
    var blur: Int
    var position: String
}

struct SkinProfileBanner: Codable {
    var enabled: Bool
    var image: String?
    var opacity: Double
    var height: Int
    var width: Int
    var position: String
}

struct SkinProfileGlass: Codable {
    var enabled: Bool
    var opacity: Double
    var blur: Int
}

struct SkinProfileBrand: Codable {
    var enabled: Bool
    var displayName: String?
    var shortMark: String?
    var logoStyle: String
    var iconImage: String?
}

struct WorkBuddyProjectHero: Codable {
    var image: String?
    var fit: String
    var position: String
}

struct WorkBuddyProfileSettings: Codable {
    var projectHero: WorkBuddyProjectHero
}

struct SkinProfileAdvanced: Codable {
    var enabled: Bool
    var background: SkinProfileBackground
    var banner: SkinProfileBanner
    var glass: SkinProfileGlass
    var brand: SkinProfileBrand
    var workbuddy: WorkBuddyProfileSettings?
    var radius: Int
    var motion: String
    var sidebarWidth: Int
}

struct SkinProfile: Codable, Identifiable {
    let schemaVersion: Int
    var id: String
    var name: String
    var createdAt: String
    var updatedAt: String
    var official: SkinProfileOfficial
    var advanced: SkinProfileAdvanced

    var projectHero: WorkBuddyProjectHero {
        get {
            advanced.workbuddy?.projectHero ?? WorkBuddyProjectHero(
                image: nil,
                fit: "cover",
                position: "center"
            )
        }
        set {
            advanced.workbuddy = WorkBuddyProfileSettings(projectHero: newValue)
            advanced.enabled = true
        }
    }

    static func defaultWorkBuddy(id: String) -> SkinProfile {
        let now = ISO8601DateFormatter().string(from: Date())
        return SkinProfile(
            schemaVersion: 1,
            id: id,
            name: LingGlowL10n.string("我的 WorkBuddy 皮肤"),
            createdAt: now,
            updatedAt: now,
            official: SkinProfileOfficial(
                variant: "dark",
                codeThemeId: "codex",
                accent: "#7AA2F7",
                surface: "#111827",
                ink: "#E5E7EB",
                contrast: 45,
                fonts: SkinProfileFonts(code: nil, ui: nil),
                opaqueWindows: true,
                semanticColors: SkinProfileSemanticColors(
                    diffAdded: "#22C55E",
                    diffRemoved: "#EF4444",
                    skill: "#A78BFA"
                )
            ),
            advanced: SkinProfileAdvanced(
                enabled: true,
                background: SkinProfileBackground(
                    image: nil,
                    opacity: 0.55,
                    overlay: 0.58,
                    blur: 0,
                    position: "center"
                ),
                banner: SkinProfileBanner(
                    enabled: false,
                    image: nil,
                    opacity: 0.45,
                    height: 112,
                    width: 720,
                    position: "top-center"
                ),
                glass: SkinProfileGlass(enabled: true, opacity: 0.74, blur: 18),
                brand: SkinProfileBrand(
                    enabled: false,
                    displayName: nil,
                    shortMark: nil,
                    logoStyle: "original",
                    iconImage: nil
                ),
                workbuddy: WorkBuddyProfileSettings(
                    projectHero: WorkBuddyProjectHero(image: nil, fit: "cover", position: "center")
                ),
                radius: 16,
                motion: "subtle",
                sidebarWidth: 275
            )
        )
    }
}

struct ProfilesResponse: Decodable {
    let ok: Bool
    let profiles: [SkinProfile]
}

struct ProfileResponse: Decodable {
    let ok: Bool
    let profile: SkinProfile
}

struct ProfilePreviewResponse: Decodable {
    let ok: Bool
    let profile: SkinProfile
}

struct WorkBuddyFreeBrand: Codable {
    let schemaVersion: Int?
    var displayName: String?
    var tagline: String?
    var iconImage: String?
    var composerAvatarImage: String?
    var composerAvatarMotion: String?
    var codexHomeTitle: String?
    var doubaoHomeTitle: String?
    var workbuddyHomeTitle: String?
    let updatedAt: String?

    static let original = WorkBuddyFreeBrand(
        schemaVersion: 1,
        displayName: nil,
        tagline: nil,
        iconImage: nil,
        composerAvatarImage: nil,
        composerAvatarMotion: nil,
        codexHomeTitle: nil,
        doubaoHomeTitle: nil,
        workbuddyHomeTitle: nil,
        updatedAt: nil
    )
}

struct FreeBrandResponse: Decodable {
    let ok: Bool
    let freeBrand: WorkBuddyFreeBrand
}

struct WeekAssignments: Codable {
    var monday: String?
    var tuesday: String?
    var wednesday: String?
    var thursday: String?
    var friday: String?
    var saturday: String?
    var sunday: String?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case monday, tuesday, wednesday, thursday, friday, saturday, sunday
    }

    init(
        monday: String? = nil,
        tuesday: String? = nil,
        wednesday: String? = nil,
        thursday: String? = nil,
        friday: String? = nil,
        saturday: String? = nil,
        sunday: String? = nil
    ) {
        self.monday = monday
        self.tuesday = tuesday
        self.wednesday = wednesday
        self.thursday = thursday
        self.friday = friday
        self.saturday = saturday
        self.sunday = sunday
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        monday = try container.decodeIfPresent(String.self, forKey: .monday)
        tuesday = try container.decodeIfPresent(String.self, forKey: .tuesday)
        wednesday = try container.decodeIfPresent(String.self, forKey: .wednesday)
        thursday = try container.decodeIfPresent(String.self, forKey: .thursday)
        friday = try container.decodeIfPresent(String.self, forKey: .friday)
        saturday = try container.decodeIfPresent(String.self, forKey: .saturday)
        sunday = try container.decodeIfPresent(String.self, forKey: .sunday)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try encode(monday, into: &container, forKey: .monday)
        try encode(tuesday, into: &container, forKey: .tuesday)
        try encode(wednesday, into: &container, forKey: .wednesday)
        try encode(thursday, into: &container, forKey: .thursday)
        try encode(friday, into: &container, forKey: .friday)
        try encode(saturday, into: &container, forKey: .saturday)
        try encode(sunday, into: &container, forKey: .sunday)
    }

    private func encode(
        _ value: String?,
        into container: inout KeyedEncodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) throws {
        if let value {
            try container.encode(value, forKey: key)
        } else {
            try container.encodeNil(forKey: key)
        }
    }

    func value(for day: Weekday) -> String? {
        switch day {
        case .monday: return monday
        case .tuesday: return tuesday
        case .wednesday: return wednesday
        case .thursday: return thursday
        case .friday: return friday
        case .saturday: return saturday
        case .sunday: return sunday
        }
    }

    mutating func set(_ value: String?, for day: Weekday) {
        switch day {
        case .monday: monday = value
        case .tuesday: tuesday = value
        case .wednesday: wednesday = value
        case .thursday: thursday = value
        case .friday: friday = value
        case .saturday: saturday = value
        case .sunday: sunday = value
        }
    }
}

/// The backend owns the exact schedule schema, while the generated ClientID
/// bridge supplies the locally supported Agent list.  A keyed dictionary keeps
/// this native model forward-compatible when the registry gains an Agent: a
/// newly generated client case gets an empty slot automatically, and an
/// unknown slot returned by a newer local backend survives a read/save cycle.
struct ScheduleClients: Codable {
    private var values: [String: WeekAssignments]

    init() {
        values = Dictionary(uniqueKeysWithValues: ClientID.allCases.map {
            ($0.rawValue, WeekAssignments())
        })
    }

    private enum CodingError: Error {
        case invalidClientKey
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        var decoded: [String: WeekAssignments] = [:]
        for key in container.allKeys {
            guard key.stringValue.range(of: "^[a-z][a-z0-9-]{1,47}$", options: .regularExpression) != nil else {
                throw CodingError.invalidClientKey
            }
            decoded[key.stringValue] = try container.decode(WeekAssignments.self, forKey: key)
        }
        for client in ClientID.allCases where decoded[client.rawValue] == nil {
            decoded[client.rawValue] = WeekAssignments()
        }
        values = decoded
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        for (clientId, assignments) in values {
            guard let key = DynamicCodingKey(stringValue: clientId) else { continue }
            try container.encode(assignments, forKey: key)
        }
    }

    func assignments(for client: ClientID) -> WeekAssignments {
        values[client.rawValue] ?? WeekAssignments()
    }

    mutating func set(_ assignments: WeekAssignments, for client: ClientID) {
        values[client.rawValue] = assignments
    }
}

struct WeeklySchedule: Codable {
    let schemaVersion: Int
    var enabled: Bool
    var remindOnLaunch: Bool
    var timeZone: String
    var clients: ScheduleClients
}

struct ScheduleResponse: Decodable {
    let ok: Bool
    let schedule: WeeklySchedule
}

struct IntentImpact: Decodable {
    let requiresRestart: Bool
    let targetRunning: Bool
    let message: String?
}

struct IntentSummary: Decodable {
    let clientId: String
    let skinId: String
    let operation: String
    let impact: IntentImpact
    let customProfile: Bool
}

struct ApplyIntent: Decodable {
    let id: String
    let expiresAt: String
    let summary: IntentSummary
}

struct ApplyIntentResponse: Decodable {
    let ok: Bool
    let intent: ApplyIntent
}

/// One row in the native multi-Agent apply summary. The local backend still
/// mints and consumes an independent one-time intent for every Agent; this
/// value only lets one user confirmation report those operations together.
struct AgentSkinApplyOutcome: Identifiable {
    let client: ClientID
    let succeeded: Bool
    let message: String

    var id: String { client.rawValue }
}

struct OperationResponse: Decodable {
    let ok: Bool
    let operation: String
}

struct EntitlementResponse: Decodable {
    let ok: Bool
    let entitlement: EntitlementInfo
}

struct LoginAgentResponse: Decodable {
    let ok: Bool
    let loginAgent: LoginAgentStatus
}

struct ReminderDecisionResponse: Decodable {
    let ok: Bool
    let action: String
    let minutes: Int?
    let skinId: String
    /// Newer local hosts prepare a one-time intent for an `apply` reminder
    /// but do not claim the reminder until that intent is confirmed.  Keeping
    /// this optional lets a signed native app remain compatible with an older
    /// local host that only returns the selected skin ID.
    let intent: ApplyIntent?
}

struct EmptyResponse: Decodable {
    let ok: Bool
}

struct APIErrorPayload: Decodable {
    let ok: Bool?
    let error: String?
    let code: String?
}

struct EmptyRequest: Encodable {}

struct RemoteSkinInstallRequest: Encodable {
    let skinId: String
    let clientId: String
}

struct DoctorRefreshRequest: Encodable {
    let clientId: String?
}

struct ApplyIntentRequest: Encodable {
    let clientId: String
    let skinId: String?
    let operation: String
}

struct ConfirmIntentRequest: Encodable {
    let clientId: String
}

struct LicenseActivationRequest: Encodable {
    let code: String
    let skinId: String?
}

struct DraftPromotionRequest: Encodable {
    let confirm: Bool
}

struct LoginAgentRequest: Encodable {
    let action: String
}

struct ScheduleSaveRequest: Encodable {
    let schedule: WeeklySchedule
}

struct ReminderDecisionRequest: Encodable {
    let clientId: String
    let action: String
    let minutes: Int?
}

struct ProfilePreviewRequest: Encodable {
    let clientId: String
    let skinId: String
}

struct FreeBrandSaveRequest: Encodable {
    let clientId: String
    let displayName: String?
    let tagline: String?
    let iconImage: String?
    let composerAvatarImage: String?
    let composerAvatarMotion: String?
    let codexHomeTitle: String?
    let doubaoHomeTitle: String?
    let workbuddyHomeTitle: String?
}

import AppKit
import SwiftUI

private enum LingGlowLegalLinks {
    static let privacy = URL(string: "https://github.com/AI-Scarlett/LingGlow/blob/main/docs/PRIVACY.md")!
    static let purchaseTerms = URL(string: "https://github.com/AI-Scarlett/LingGlow/blob/main/docs/PURCHASE-TERMS.md")!
    static let dodoPrivacy = URL(string: "https://dodopayments.com/privacy-policy")!
    static let skinGuide = URL(string: "https://github.com/AI-Scarlett/LingGlow/blob/main/docs/CREATE-SKIN-WITH-SKILL.md")!
    static let skillArchive = URL(string: "https://github.com/AI-Scarlett/LingGlow/releases/latest/download/LingGlow-Skin-Skill.zip")!
}

struct StudioRootView: View {
    @ObservedObject var model: StudioModel
    @State private var selectedTab: StudioTab = .skins

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            VStack(spacing: 0) {
                detailHeader
                messageArea
                cachedTabContent
            }
        }
        .background(LingGlowBackdrop())
        .foregroundStyle(LingGlowPalette.text)
        .environment(\.locale, model.interfaceLocale)
        // Some dynamic labels are resolved from backend/catalog strings rather
        // than SwiftUI LocalizedStringKey values. Recreate the view tree for a
        // language change so every one of those labels refreshes immediately.
        .id(model.interfaceLanguage)
        .preferredColorScheme(.light)
        .frame(
            minWidth: 900,
            idealWidth: 1120,
            maxWidth: .infinity,
            minHeight: 650,
            idealHeight: 780,
            maxHeight: .infinity
        )
    }

    private var sidebar: some View {
        VStack(spacing: 20) {
            VStack(spacing: 8) {
                brandMark
                Text("灵妆")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(LingGlowPalette.ink)
            }

            VStack(spacing: 8) {
                sidebarButton(.skins, icon: "square.grid.2x2.fill")
                sidebarButton(.custom, icon: "paintbrush.pointed.fill")
                sidebarButton(.schedule, icon: "calendar.badge.clock")
                sidebarButton(.account, icon: "key.fill")
                sidebarButton(.support, icon: "bubble.left.and.bubble.right.fill")
                sidebarButton(.settings, icon: "gearshape.fill")
            }

            Spacer()

            VStack(spacing: 7) {
                ZStack {
                    Circle().fill(connectionColor.opacity(0.2)).frame(width: 26, height: 26)
                    Circle().fill(connectionColor).frame(width: 8, height: 8)
                }
                Text(updateCount > 0
                     ? LingGlowL10n.string("%lld 套可更新", updateCount)
                     : model.connectionState.label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(LingGlowPalette.ink.opacity(0.62))
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 22)
        .frame(width: 108)
        .background(LingGlowSidebarBackground())
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.white.opacity(0.07)).frame(width: 1)
        }
    }

    private var brandMark: some View {
        Image(nsImage: LingGlowBrandAssets.appIconImage())
            .resizable()
            .scaledToFill()
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.white.opacity(0.42)))
    }

    private func sidebarButton(_ tab: StudioTab, icon: String) -> some View {
        Button {
            selectedTab = tab
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                Text(tab.title)
                    .font(.system(size: 10, weight: selectedTab == tab ? .bold : .medium))
                if tab == .skins && updateCount > 0 {
                    Circle()
                        .fill(LingGlowPalette.coral)
                        .frame(width: 6, height: 6)
                        .overlay(Circle().stroke(LingGlowPalette.ink, lineWidth: 1.5))
                        .offset(x: 13, y: -38)
                }
            }
            .foregroundStyle(selectedTab == tab ? LingGlowPalette.ink : LingGlowPalette.ink.opacity(0.62))
            .frame(width: 72, height: 58)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(selectedTab == tab ? LingGlowPalette.accentSoft : Color.clear)
            }
        }
        .buttonStyle(.plain)
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var detailHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(selectedTab.title)
                    .font(.system(size: 23, weight: .bold, design: .rounded))
                Text(detailSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if selectedTab == .skins {
                Button {
                    Task { await model.refreshAll(manuallySyncTemplates: true) }
                } label: {
                    Label("同步模板", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)
                .tint(LingGlowPalette.berry)
                .disabled(model.isTemplateSyncing)
            }
            if model.isBusy || model.isTemplateSyncing { ProgressView().controlSize(.small) }
        }
        .padding(.horizontal, LingGlowLayout.pageInset)
        .frame(height: 80)
        .background(LingGlowPalette.surface.opacity(0.74))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.primary.opacity(0.07)).frame(height: 1)
        }
    }

    private var cachedTabContent: some View {
        ZStack {
            cachedPage(.skins) {
                SkinsView(model: model) { selectedTab = .custom }
            }
            cachedPage(.custom) {
                CustomSkinsView(model: model) { selectedTab = .skins }
            }
            cachedPage(.schedule) {
                ScheduleView(model: model) { selectedTab = .account }
            }
            cachedPage(.account) {
                AccountView(model: model) { selectedTab = .skins }
            }
            cachedPage(.support) {
                ContactSupportView()
            }
            cachedPage(.settings) {
                SettingsView(model: model)
            }
        }
        .background(LingGlowPanelBackground())
    }

    private func cachedPage<Content: View>(
        _ tab: StudioTab,
        @ViewBuilder content: () -> Content
    ) -> some View {
        ScrollView {
            content()
                .frame(maxWidth: LingGlowLayout.contentWidth)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(.horizontal, LingGlowLayout.pageInset)
                .padding(.top, 8)
                .padding(.bottom, 36)
        }
        // Keep every top-level page mounted so its decoded previews, filters,
        // editor state, and scroll position survive tab changes.
        .opacity(selectedTab == tab ? 1 : 0)
        .allowsHitTesting(selectedTab == tab)
        .accessibilityHidden(selectedTab != tab)
        .zIndex(selectedTab == tab ? 1 : 0)
    }

    private var detailSubtitle: String {
        switch selectedTab {
        case .skins: return LingGlowL10n.string("浏览、下载并管理三个 Agent 的皮肤 · 后台每小时检查一次")
        case .custom: return LingGlowL10n.string("创建模板并统一管理三端外观素材")
        case .schedule: return LingGlowL10n.string("按星期自动切换已安装模板")
        case .account: return LingGlowL10n.string("购买、兑换与同步你的使用权益")
        case .support: return LingGlowL10n.string("加入交流群或联系一对一咨询")
        case .settings: return LingGlowL10n.string("更新、安全、诊断与法律信息")
        }
    }

    private var updateCount: Int {
        Set(model.catalogs.values
            .flatMap { $0 }
            .filter { $0.updateAvailable == true }
            .map(\.id)).count
    }

    @ViewBuilder
    private var messageArea: some View {
        if let error = model.errorMessage {
            MessageBanner(text: error, color: .red, symbol: "exclamationmark.triangle.fill") {
                model.clearMessages()
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 10)
        } else if let success = model.successMessage {
            MessageBanner(text: success, color: .green, symbol: "checkmark.circle.fill") {
                model.clearMessages()
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 10)
        }
    }

    private var connectionColor: Color {
        switch model.connectionState {
        case .starting: return .orange
        case .connected: return .green
        case .disconnected: return .red
        }
    }
}

private struct MessageBanner: View {
    let text: String
    let color: Color
    let symbol: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(color)
            Text(LingGlowL10n.string(text))
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.caption)
            }
            .buttonStyle(.plain)
        }
        .padding(10)
        .background(color.opacity(0.09), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

private struct ClientPicker: View {
    @Binding var selection: ClientID
    var clients: [ClientID] = ClientID.allCases
    var showsHint = true
    var compact = false
    @State private var hoveredClient: ClientID?

    var body: some View {
        let controlHeight: CGFloat = compact ? 36 : 40
        let horizontalPadding: CGFloat = compact ? 11 : 15
        let outerPadding: CGFloat = compact ? 4 : 6
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(clients) { client in
                    let isSelected = selection == client
                    let isHovered = hoveredClient == client
                    Button {
                        selection = client
                    } label: {
                        HStack(spacing: 8) {
                            ClientBrandIcon(client: client, size: 19)
                            Text(client.displayName)
                                .lineLimit(1)
                        }
                        .font(.subheadline.weight(isSelected ? .semibold : .medium))
                        .foregroundStyle(isSelected ? Color.white : LingGlowPalette.text.opacity(0.72))
                        .padding(.horizontal, horizontalPadding)
                        .frame(height: controlHeight)
                        .background {
                            if isSelected {
                                LinearGradient(
                                    colors: [LingGlowPalette.accent, LingGlowPalette.berry],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            } else if isHovered {
                                Color.white.opacity(0.58)
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(isSelected ? Color.white.opacity(0.32) : Color.clear, lineWidth: 1)
                        }
                        .shadow(color: isSelected ? LingGlowPalette.berry.opacity(0.22) : .clear, radius: 8, y: 3)
                    }
                    .buttonStyle(.plain)
                    .onHover { hovering in
                        hoveredClient = hovering ? client : nil
                    }
                }
            }

            Spacer()

            if showsHint {
                Label("选择要换肤的 Agent", systemImage: "sparkles")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(LingGlowPalette.text.opacity(0.45))
                    .lineLimit(1)
            }
        }
        .padding(outerPadding)
        .background(Color.white.opacity(0.34), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(LingGlowPalette.berry.opacity(0.10), lineWidth: 1)
        }
        .shadow(color: LingGlowPalette.ink.opacity(0.035), radius: 12, y: 5)
    }
}

private struct CatalogFilterOption: Identifiable {
    let id: String
    let title: String
}

private struct CatalogFilterMenu: View {
    let title: String
    let symbol: String
    let options: [CatalogFilterOption]
    @Binding var selection: String
    @State private var isHovered = false

    private var selectedTitle: String {
        options.first(where: { $0.id == selection })?.title ?? options.first?.title ?? ""
    }

    var body: some View {
        Menu {
            ForEach(options) { option in
                Button {
                    selection = option.id
                } label: {
                    if selection == option.id {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(LingGlowPalette.berry)
                Text(selectedTitle)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(LingGlowPalette.text.opacity(0.78))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(LingGlowPalette.text.opacity(0.38))
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(isHovered ? LingGlowPalette.berry.opacity(0.09) : LingGlowPalette.berry.opacity(0.055))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(LingGlowPalette.berry.opacity(isHovered ? 0.24 : 0.11), lineWidth: 1)
            }
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .onHover { isHovered = $0 }
        .help(LingGlowL10n.string(title))
        .accessibilityLabel(LingGlowL10n.string(title))
        .accessibilityValue(selectedTitle)
    }
}

private struct CatalogSegmentedControl<Option: Hashable>: View {
    let title: String
    let symbol: String
    let options: [Option]
    @Binding var selection: Option
    let optionTitle: (Option) -> String
    @State private var hoveredOption: Option?

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(LingGlowPalette.berry)
                .padding(.leading, 8)
                .help(LingGlowL10n.string(title))

            ForEach(options, id: \.self) { option in
                let isSelected = selection == option
                let isHovered = hoveredOption == option
                Button {
                    selection = option
                } label: {
                    Text(optionTitle(option))
                        .font(.caption.weight(isSelected ? .semibold : .medium))
                        .foregroundStyle(isSelected ? LingGlowPalette.berry : LingGlowPalette.text.opacity(0.66))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity)
                        .frame(height: 28)
                        .background {
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .fill(isSelected ? Color.white.opacity(0.92) : (isHovered ? Color.white.opacity(0.48) : Color.clear))
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .stroke(isSelected ? LingGlowPalette.berry.opacity(0.16) : Color.clear, lineWidth: 1)
                        }
                        .shadow(color: isSelected ? LingGlowPalette.ink.opacity(0.06) : .clear, radius: 4, y: 2)
                }
                .buttonStyle(.plain)
                .onHover { hovering in
                    hoveredOption = hovering ? option : nil
                }
            }
        }
        .padding(4)
        .frame(height: 36)
        .background(LingGlowPalette.berry.opacity(0.055), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(LingGlowPalette.berry.opacity(0.10), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(LingGlowL10n.string(title))
    }
}

private struct ClientBrandIcon: View {
    let client: ClientID
    let size: CGFloat

    var body: some View {
        Group {
            if let icon = installedAppIcon {
                Image(nsImage: icon)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: fallbackSymbol)
                    .resizable()
                    .scaledToFit()
                    .padding(2)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
    }

    private var installedAppIcon: NSImage? {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            return nil
        }
        return NSWorkspace.shared.icon(forFile: url.path)
    }

    private var bundleIdentifier: String {
        switch client {
        case .workbuddy: return "com.workbuddy.workbuddy"
        case .doubao: return "com.bot.pc.doubao"
        case .codex: return "com.openai.codex"
        }
    }

    private var fallbackSymbol: String {
        switch client {
        case .workbuddy: return "sparkles"
        case .doubao: return "message.fill"
        case .codex: return "terminal.fill"
        }
    }
}

private enum CatalogTierFilter: String, CaseIterable, Identifiable {
    case all
    case free
    case vip

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return LingGlowL10n.string("全部")
        case .free: return LingGlowL10n.string("免费")
        case .vip: return "VIP"
        }
    }
}

private struct SkinsView: View {
    @ObservedObject var model: StudioModel
    let showCustomSkins: () -> Void
    @State private var showingCustomEditor = false
    @State private var showingFreeBrandEditor = false
    @State private var unlockingSkin: CatalogSkin?
    @State private var applyingSkin: CatalogSkin?
    @State private var searchText = ""
    @State private var selectedCategory = "all"
    @State private var selectedLabelCategory = "all"
    @State private var selectedTier: CatalogTierFilter = .all
    @State private var selectedShelf: CatalogShelfFilter = .latest

    private enum CatalogShelfFilter: String, CaseIterable, Identifiable {
        case latest
        case recommended
        case all
        case mine

        var id: String { rawValue }
        var title: String {
            switch self {
            case .latest: return LingGlowL10n.string("最新")
            case .recommended: return LingGlowL10n.string("推荐")
            case .all: return LingGlowL10n.string("全部")
            case .mine: return LingGlowL10n.string("我的皮肤")
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: LingGlowLayout.sectionSpacing) {
            catalogToolbar
            catalogSummaryStrip

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("皮肤画廊")
                        .font(.title3.bold())
                    Text("下载与应用分离，只保留你真正喜欢的作品")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(filteredSkins.count == model.selectedCatalog.count
                     ? LingGlowL10n.string("%lld 套", model.selectedCatalog.count)
                     : LingGlowL10n.string("%lld / %lld 套", filteredSkins.count, model.selectedCatalog.count))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if filteredSkins.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: model.selectedClient == .doubao ? "shield.lefthalf.filled" : "arrow.triangle.2.circlepath")
                        .font(.title3)
                        .foregroundStyle(model.selectedClient == .doubao ? Color.orange : Color.secondary)
                    Text(emptyCatalogMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 30)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 340, maximum: 520), spacing: 16)], spacing: 16) {
                    ForEach(filteredSkins) { skin in
                        SkinCard(
                            skin: skin,
                            active: model.selectedStatus?.session.profileId == skin.id,
                            locked: !model.canUse(skin),
                            canApply: canApply(skin),
                            compatibilityWarning: model.selectedStatus?.compatibility.advancedAllowed != true,
                            effectiveCapabilities: Set(model.selectedStatus?.capabilities ?? []),
                            compatibilityLevel: model.selectedStatus?.compatibility.level,
                            clientName: model.selectedClient.displayName,
                            owned: model.entitlement?.purchasedSkinIds.contains(skin.id) == true,
                            showAgentBadges: selectedShelf == .mine,
                            busy: model.isBusy
                        ) {
                            if !model.canUse(skin) {
                                unlockingSkin = skin
                            } else if skin.needsDownloadOrUpdate {
                                download(skin)
                            } else {
                                applyingSkin = skin
                            }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showingCustomEditor) {
            AgentCustomEditor(model: model, initialClient: model.selectedClient)
        }
        .sheet(isPresented: $showingFreeBrandEditor) {
            FreeAppearanceEditor(model: model)
        }
        .sheet(item: $unlockingSkin) { skin in
            LicenseUnlockSheet(
                model: model,
                target: .skin(skin),
                showOtherDestination: showCustomSkins
            )
        }
        .sheet(item: $applyingSkin) { skin in
            SkinAgentApplySheet(
                model: model,
                skin: skin,
                initialClient: model.selectedClient
            )
        }
    }

    private var catalogToolbar: some View {
        let updates = model.availableSkinUpdateCount(for: model.selectedClient)
        return VStack(spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    ClientPicker(
                        selection: $model.selectedClient,
                        showsHint: false,
                        compact: true
                    )
                    .frame(minWidth: 360, maxWidth: 470)
                    catalogSearchField
                        .frame(minWidth: 220, maxWidth: .infinity)
                }

                VStack(spacing: 8) {
                    ClientPicker(
                        selection: $model.selectedClient,
                        showsHint: false,
                        compact: true
                    )
                    catalogSearchField
                }
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    catalogMenuFilters
                    catalogSegmentFilters
                    catalogUpdateButton(updates: updates)
                }

                VStack(spacing: 8) {
                    HStack(spacing: 8) {
                        catalogMenuFilters
                    }
                    HStack(spacing: 8) {
                        catalogSegmentFilters
                        catalogUpdateButton(updates: updates)
                    }
                }
            }
        }
    }

    private var catalogSearchField: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("搜索名称、系列或标签", text: $searchText)
                .textFieldStyle(.plain)
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(Color.white.opacity(0.42), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(LingGlowPalette.berry.opacity(0.10), lineWidth: 1)
        }
    }

    private var catalogMenuFilters: some View {
        Group {
            CatalogFilterMenu(
                title: "风格",
                symbol: "paintpalette.fill",
                options: [CatalogFilterOption(id: "all", title: LingGlowL10n.string("全部风格"))]
                    + availableCategories.map { CatalogFilterOption(id: $0, title: categoryLabel($0)) },
                selection: $selectedCategory
            )
            .frame(minWidth: 120, maxWidth: .infinity)

            CatalogFilterMenu(
                title: "标签",
                symbol: "tag.fill",
                options: [CatalogFilterOption(id: "all", title: LingGlowL10n.string("全部标签"))]
                    + SkinLabelCategory.allCases.map { CatalogFilterOption(id: $0.rawValue, title: $0.title) },
                selection: $selectedLabelCategory
            )
            .frame(minWidth: 116, maxWidth: .infinity)
        }
    }

    private var catalogSegmentFilters: some View {
        Group {
            CatalogSegmentedControl(
                title: "陈列",
                symbol: "rectangle.grid.1x2.fill",
                options: CatalogShelfFilter.allCases,
                selection: $selectedShelf,
                optionTitle: { $0.title }
            )
            .frame(minWidth: 210, maxWidth: .infinity)

            CatalogSegmentedControl(
                title: "权益",
                symbol: "crown.fill",
                options: CatalogTierFilter.allCases,
                selection: $selectedTier,
                optionTitle: { $0.title }
            )
            .frame(minWidth: 164, maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private func catalogUpdateButton(updates: Int) -> some View {
        if updates > 0 {
            Button {
                Task { await model.updateAllRemoteSkins(for: model.selectedClient) }
            } label: {
                Label(
                    model.isBatchUpdatingSkins
                        ? LingGlowL10n.string(
                            "正在更新 %lld/%lld",
                            model.batchSkinUpdateCompleted,
                            model.batchSkinUpdateTotal
                        )
                        : LingGlowL10n.string("更新全部（%lld）", updates),
                    systemImage: "arrow.down.circle.fill"
                )
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 11)
                    .frame(height: 36)
                    .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.orange.opacity(0.18), lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: true, vertical: false)
            .disabled(model.isBusy)
        }
    }

    private var availableCategories: [String] {
        Array(Set(model.selectedCatalog.map { $0.category ?? "other" })).sorted()
    }

    private var filteredSkins: [CatalogSkin] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return shelfSkins.filter { skin in
            let categoryMatches = selectedCategory == "all" || (skin.category ?? "other") == selectedCategory
            let labelMatches = selectedLabelCategory == "all" ||
                (skin.labelCategory ?? SkinLabelCategory.other.rawValue) == selectedLabelCategory
            let tierMatches: Bool
            switch selectedTier {
            case .all: tierMatches = true
            case .free: tierMatches = !skin.isVIP
            case .vip: tierMatches = skin.isVIP
            }
            let labelTitle = skin.labelCategory.flatMap { SkinLabelCategory(rawValue: $0)?.title } ?? "其它"
            let haystack = ([skin.name, skin.description, skin.series ?? "", labelTitle] + (skin.tags ?? [])).joined(separator: " ")
            let queryMatches = query.isEmpty || haystack.localizedCaseInsensitiveContains(query)
            return categoryMatches && labelMatches && tierMatches && queryMatches
        }
    }

    private var shelfSkins: [CatalogSkin] {
        switch selectedShelf {
        case .latest:
            // ISO-8601 timestamps sort lexicographically. For a verified legacy
            // catalog without `publishedAt`, the catalog's append order is the
            // compatibility publication order, so newer entries still win.
            return Array(model.selectedCatalog.enumerated().sorted { left, right in
                let leftDate = left.element.publishedAt ?? ""
                let rightDate = right.element.publishedAt ?? ""
                if leftDate != rightDate { return leftDate > rightDate }
                return left.offset > right.offset
            }.prefix(6).map(\.element))
        case .recommended:
            return model.selectedCatalog.filter { skin in
                (skin.tags ?? []).contains("featured") ||
                    skin.id == "spain-2026-champions"
            }
        case .all:
            return model.selectedCatalog
        case .mine:
            return model.selectedCatalog.filter { skin in
                skin.isInstalled ||
                    model.entitlement?.purchasedSkinIds.contains(skin.id) == true
            }
        }
    }

    private func categoryLabel(_ category: String) -> String {
        switch category {
        case "sports": return LingGlowL10n.string("运动")
        case "fantasy": return LingGlowL10n.string("幻想")
        case "nature": return LingGlowL10n.string("自然")
        case "minimal": return LingGlowL10n.string("简约")
        case "art": return LingGlowL10n.string("艺术")
        case "seasonal": return LingGlowL10n.string("节日")
        default: return LingGlowL10n.string("其他")
        }
    }

    @ViewBuilder
    private var catalogSummaryStrip: some View {
        if let selectedStatus = model.selectedStatus,
           selectedStatus.compatibility.advancedAllowed != true {
            responsiveSummaryStrip {
                blockedClientNotice
            }
        } else if model.selectedStatus?.compatibility.level == "generic-safe" {
            responsiveSummaryStrip {
                genericSafeClientNotice
            }
        } else {
            pairedAppearanceSummaries
        }
    }

    private func responsiveSummaryStrip<Notice: View>(
        @ViewBuilder notice: () -> Notice
    ) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                clientSummary
                freeBrandSummary
                notice()
            }
            .frame(minWidth: 780)

            VStack(spacing: 10) {
                pairedAppearanceSummaries
                notice()
            }
        }
    }

    private var pairedAppearanceSummaries: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                clientSummary
                freeBrandSummary
            }
            .frame(minWidth: 500)

            VStack(spacing: 10) {
                clientSummary
                freeBrandSummary
            }
        }
    }

    private var blockedClientNotice: some View {
        let reason = model.selectedStatus?.compatibility.reason
            ?? "目标 Agent 的安全检查尚未通过。"
        let detail = "兼容状态不会锁定皮肤；应用时会按当前可用能力自动降级。若目标未安装或签名异常，操作会明确提示且不会注入 \(model.selectedClient.displayName)。\n\(LingGlowL10n.string(reason))"
        return HStack(alignment: .center, spacing: 9) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .frame(width: 24, height: 24)
                .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 2) {
                Text("\(model.selectedClient.displayName) 存在兼容或安装问题，仍可尝试应用")
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(LingGlowL10n.string(detail))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .help(LingGlowL10n.string(detail))
            }
            Spacer(minLength: 8)
            Button {
                Task { await model.refreshDoctor() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .controlSize(.small)
            .disabled(model.isBusy)
            .help(LingGlowL10n.string("重新检测"))
        }
        .studioCard(padding: LingGlowLayout.compactCardPadding)
        .frame(minWidth: 280, maxWidth: .infinity, minHeight: LingGlowLayout.compactSummaryHeight)
    }

    private var genericSafeClientNotice: some View {
        let detail = LingGlowL10n.string(model.selectedClient == .codex
            ? "当前 Codex 版本仍可应用背景、色板、基础玻璃层和输入框机器人；部分位置可能存在适配问题。横幅、Logo/图标、发送/停止按钮、输入框布局和侧栏宽度等精确功能暂时关闭。"
            : "仍可应用背景、色板、基础玻璃层和输入框机器人；横幅、Logo/图标、发送/停止按钮、输入框布局和侧栏宽度等精确功能自动降级。")
        let reason = model.selectedStatus?.compatibility.reason
            ?? "精确适配需先完成当前版本的运行矩阵与恢复验证。"
        return HStack(alignment: .center, spacing: 9) {
            Image(systemName: "checkmark.shield.fill")
                .foregroundStyle(.blue)
                .frame(width: 24, height: 24)
                .background(Color.blue.opacity(0.10), in: RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 2) {
                Text(LingGlowL10n.string(model.selectedClient == .codex
                     ? "Codex 已启用兼容模式"
                     : "\(model.selectedClient.displayName) 当前为基础安全模式"))
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text("\(detail) \(LingGlowL10n.string(reason))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .help("\(detail) \(LingGlowL10n.string(reason))")
            }
        }
        .studioCard(padding: LingGlowLayout.compactCardPadding)
        .frame(minWidth: 280, maxWidth: .infinity, minHeight: LingGlowLayout.compactSummaryHeight)
    }

    private var emptyCatalogMessage: String {
        if model.connectionState != .connected { return LingGlowL10n.string("灵妆正在准备皮肤目录…") }
        if let status = model.selectedStatus,
           status.compatibility.advancedAllowed != true {
            return status.compatibility.reason.map { LingGlowL10n.string($0) }
                ?? LingGlowL10n.string("当前 Agent 的实时换肤仍在安全验证中。")
        }
        return LingGlowL10n.string("当前 Agent 暂无可用内置皮肤")
    }

    private var clientSummary: some View {
        let client = model.selectedStatus
        let profileId = client?.session.profileId
        let activeName = model.selectedCatalog.first(where: { $0.id == profileId })?.name
            ?? model.profiles.first(where: { $0.id == profileId })?.name
            ?? model.unionProfiles.first(where: { $0.id == profileId })?.name
            ?? profileId
            ?? LingGlowL10n.string("官方原版")
        return HStack(spacing: 9) {
            ClientBrandIcon(client: model.selectedClient, size: 30)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(model.selectedClient.displayName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    StatusPill(
                        text: client?.running == true ? "运行中" : "未运行",
                        color: client?.running == true ? .green : .secondary
                    )
                }
                Text(client?.installed == true
                     ? "\(client?.version ?? LingGlowL10n.string("未知版本")) · \(LingGlowL10n.string(client?.compatibility.displayLevel ?? "检测中"))"
                     : LingGlowL10n.string("未检测到已验证的官方应用"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("\(LingGlowL10n.string("当前界面")) · \(LingGlowL10n.string(activeName))")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(LingGlowPalette.text.opacity(0.78))
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("恢复原版") { restore() }
                .controlSize(.small)
                .disabled(client?.session.mode == nil || model.isBusy)
        }
        .studioCard(padding: LingGlowLayout.compactCardPadding)
        .frame(minWidth: 240, maxWidth: .infinity, minHeight: LingGlowLayout.compactSummaryHeight)
    }

    private var customSkinSummary: some View {
        HStack(spacing: 11) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.pink)
                .frame(width: 34, height: 34)
                .background(Color.pink.opacity(0.11), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("自定义皮肤编辑器")
                        .font(.subheadline.weight(.semibold))
                    if !model.canEditCustomProfiles {
                        Text("可预览")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.blue)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.11), in: Capsule())
                    }
                }
                Text("按目标 Agent 的能力清单动态显示可编辑项；免费版可完整预览")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button {
                showingCustomEditor = true
            } label: {
                Label(
                    model.canEditCustomProfiles ? "打开编辑器" : "预览",
                    systemImage: model.canEditCustomProfiles ? "slider.horizontal.3" : "eye"
                )
            }
            .controlSize(.small)
        }
        .frame(maxWidth: .infinity, minHeight: LingGlowLayout.summaryHeight, alignment: .center)
        .studioCard(padding: LingGlowLayout.cardPadding)
    }

    private var freeBrandSummary: some View {
        HStack(spacing: 9) {
            Group {
                if let image = LocalImageAsset.previewImage(from: model.freeBrand.iconImage) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                        .padding(4)
                } else {
                    Image(systemName: "app.badge")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.blue)
                }
            }
            .frame(width: 30, height: 30)
            .background(Color.blue.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("Icon、机器人与首页文案")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Text("永久免费")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color.green)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.11), in: Capsule())
                }
                Text(model.freeBrand.displayName.map { LingGlowL10n.string($0) }
                     ?? LingGlowL10n.string("动作由每张皮肤独立决定"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("编辑") { showingFreeBrandEditor = true }
                .controlSize(.small)
        }
        .studioCard(padding: LingGlowLayout.compactCardPadding)
        .frame(minWidth: 240, maxWidth: .infinity, minHeight: LingGlowLayout.compactSummaryHeight)
    }

    private func canApply(_ skin: CatalogSkin) -> Bool {
        guard !model.isBusy,
              skin.isInstalled else { return false }
        return model.canUse(skin)
    }

    private func download(_ skin: CatalogSkin) {
        Task { await model.installRemoteSkin(skin) }
    }

    private func restore() {
        Task {
            guard let intent = await model.createRestoreIntent() else { return }
            guard presentIntentConfirmation(intent, skinName: "官方原版") else { return }
            await model.confirm(intent)
        }
    }
}

private struct SkinAgentApplySheet: View {
    @ObservedObject var model: StudioModel
    let skin: CatalogSkin
    let initialClient: ClientID

    @Environment(\.dismiss) private var dismiss
    @State private var selectedClients: Set<ClientID>
    @State private var outcomes: [AgentSkinApplyOutcome] = []
    @State private var applying = false
    @State private var hasApplied = false

    init(model: StudioModel, skin: CatalogSkin, initialClient: ClientID) {
        self.model = model
        self.skin = skin
        self.initialClient = initialClient
        _selectedClients = State(initialValue: [initialClient])
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(hex: skin.colors.accent).opacity(0.14))
                    Image(systemName: "paintbrush.pointed.fill")
                        .font(.system(size: 23, weight: .semibold))
                        .foregroundStyle(Color(hex: skin.colors.accent))
                }
                .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 3) {
                    Text(LingGlowL10n.string("应用「%@」", LingGlowL10n.string(skin.name)))
                        .font(.title3.bold())
                    Text(LingGlowL10n.string("勾选要使用这套皮肤的 Agent，一次确认即可。"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .disabled(applying)
            }
            .padding(22)

            Divider()

            VStack(spacing: 10) {
                ForEach(ClientID.allCases) { client in
                    agentRow(client)
                }
            }
            .padding(20)

            if hasApplied {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Text(LingGlowL10n.string("应用结果"))
                        .font(.headline)
                    ForEach(outcomes) { outcome in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: outcome.succeeded ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                                .foregroundStyle(outcome.succeeded ? Color.green : Color.red)
                            Text(outcome.client.displayName)
                                .font(.subheadline.weight(.semibold))
                                .frame(width: 86, alignment: .leading)
                            Text(LingGlowL10n.string(outcome.message))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.vertical, 16)
            }

            Divider()

            HStack {
                Text(LingGlowL10n.string("只会退出并重启已勾选的 Agent，请先保存尚未提交的内容。"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                if hasApplied {
                    Button(LingGlowL10n.string("完成")) { dismiss() }
                        .keyboardShortcut(.defaultAction)
                } else {
                    Button(LingGlowL10n.string("取消")) { dismiss() }
                        .disabled(applying)
                    Button {
                        applySelectedAgents()
                    } label: {
                        if applying {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text(LingGlowL10n.string("正在应用…"))
                            }
                        } else {
                            Text(LingGlowL10n.string("确认应用到 %lld 个 Agent", selectedSelectableClients.count))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(applying || selectedSelectableClients.isEmpty)
                }
            }
            .padding(18)
        }
        .frame(width: 590)
        // AppKit-hosted sheets can otherwise fall back to the macOS locale
        // while dynamic labels use LingGlow's in-app language preference.
        .environment(\.locale, model.interfaceLocale)
        .interactiveDismissDisabled(applying)
        .onAppear {
            let available = Set(ClientID.allCases.filter { availability(for: $0).selectable })
            selectedClients.formIntersection(available)
            if selectedClients.isEmpty,
               let fallback = ClientID.allCases.first(where: { available.contains($0) }) {
                selectedClients.insert(fallback)
            }
        }
    }

    private var selectedSelectableClients: Set<ClientID> {
        Set(selectedClients.filter { availability(for: $0).selectable })
    }

    @ViewBuilder
    private func agentRow(_ client: ClientID) -> some View {
        let availability = availability(for: client)
        let selected = selectedClients.contains(client)
        HStack(spacing: 12) {
            Toggle(isOn: Binding(
                get: { selectedClients.contains(client) },
                set: { enabled in
                    if enabled { selectedClients.insert(client) }
                    else { selectedClients.remove(client) }
                }
            )) {
                EmptyView()
            }
            .labelsHidden()
            .toggleStyle(.checkbox)
            .disabled(!availability.selectable || applying || hasApplied)

            ClientBrandIcon(client: client, size: 26)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 7) {
                    Text(client.displayName)
                        .font(.subheadline.weight(.semibold))
                    if model.status?.clients[client.rawValue]?.session.profileId == skin.id {
                        Text("使用中")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.green)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.green.opacity(0.11), in: Capsule())
                    }
                }
                Text(availability.message)
                    .font(.caption)
                    .foregroundStyle(availability.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            if selected && availability.selectable && !hasApplied {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.accentColor)
            }
        }
        .padding(13)
        .background(
            (selected && availability.selectable ? Color.accentColor.opacity(0.08) : Color.primary.opacity(0.035)),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    selected && availability.selectable ? Color.accentColor.opacity(0.32) : Color.primary.opacity(0.07),
                    lineWidth: 1
                )
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard availability.selectable, !applying, !hasApplied else { return }
            if selectedClients.contains(client) { selectedClients.remove(client) }
            else { selectedClients.insert(client) }
        }
    }

    private func availability(for client: ClientID) -> (selectable: Bool, message: String, color: Color) {
        guard skin.clientIds.contains(client.rawValue),
              let targetSkin = model.catalogs[client]?.first(where: { $0.id == skin.id }) else {
            return (false, LingGlowL10n.string("这套皮肤不支持该 Agent"), .secondary)
        }
        guard let status = model.status?.clients[client.rawValue], status.installed else {
            return (false, LingGlowL10n.string("尚未安装 %@", client.displayName), .secondary)
        }
        guard status.signatureValid, status.trustedPublisher else {
            return (false, LingGlowL10n.string("应用身份未通过安全检查"), .red)
        }
        guard targetSkin.isInstalled else {
            return (false, LingGlowL10n.string("请先下载这套皮肤"), .secondary)
        }
        guard model.canUse(targetSkin) else {
            return (false, LingGlowL10n.string("需要 VIP 或该皮肤的购买/兑换授权"), .orange)
        }
        guard status.compatibility.advancedAllowed else {
            return (false, status.compatibility.reason.map(LingGlowL10n.error)
                ?? LingGlowL10n.string("当前 Agent 未通过运行安全检查"), .red)
        }

        let running = status.running || status.session.state == "active"
        if status.compatibility.level == "generic-safe" {
            let action = running ? LingGlowL10n.string("确认后重启") : LingGlowL10n.string("确认后启动")
            return (true, LingGlowL10n.string("可能存在适配问题 · %@", action), .orange)
        }
        return (true, running
            ? LingGlowL10n.string("精确适配 · 确认后重启")
            : LingGlowL10n.string("精确适配 · 确认后启动"), .secondary)
    }

    private func applySelectedAgents() {
        let clients = selectedSelectableClients
        guard !applying, !clients.isEmpty else { return }
        applying = true
        Task {
            outcomes = await model.applyCatalogSkin(skin, to: clients)
            hasApplied = true
            applying = false
        }
    }
}

private enum LicenseUnlockTarget {
    case skin(CatalogSkin)
    case customSlot

    var offerType: String {
        switch self {
        case .skin: return "skin_once"
        case .customSlot: return "custom_slot_once"
        }
    }

    var activationContext: LicenseActivationContext {
        switch self {
        case let .skin(skin): return .skin(skin)
        case .customSlot: return .customSlot
        }
    }
}

/// One closed-loop purchase and redemption surface is shared by catalog skins
/// and the custom-skin workspace. Dodo remains responsible for identifying the
/// license purpose; opening this sheet never guesses an offer type from UI
/// context and never sends a skin ID on the first request.
private struct LicenseUnlockSheet: View {
    @ObservedObject var model: StudioModel
    let target: LicenseUnlockTarget
    let showOtherDestination: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var acceptedPurchaseTerms = false
    @State private var showingPurchaseConsent = false
    @State private var recognizedMessage: String?

    private var product: ProductCatalogItem? {
        model.productCatalog?.products.first(where: { $0.offerType == target.offerType })
    }

    private var title: String {
        switch target {
        case let .skin(skin):
            return LingGlowL10n.string("解锁「%@」", LingGlowL10n.string(skin.name))
        case .customSlot:
            return LingGlowL10n.string("解锁自定义皮肤")
        }
    }

    private var subtitle: String {
        switch target {
        case .skin:
            return LingGlowL10n.string("购买当前皮肤授权，或直接输入已有授权码")
        case .customSlot:
            return LingGlowL10n.string("购买一个永久自定义皮肤位，或直接输入已有授权码")
        }
    }

    /// A permanent single-theme purchase is deliberately bound to one exact
    /// skin ID.  Surface that existing binding before offering another theme
    /// so an "OWNED" account cannot be mistaken for an all-themes license.
    private var existingSkinBindingNotice: String? {
        guard case let .skin(targetSkin) = target else { return nil }
        let ownedSkinIds = model.entitlement?.purchasedSkinIds.sorted() ?? []
        guard !ownedSkinIds.isEmpty, !ownedSkinIds.contains(targetSkin.id) else { return nil }

        let ownedNames = ownedSkinIds.map { skinId in
            if let skin = model.selectedCatalog.first(where: { $0.id == skinId }) {
                return LingGlowL10n.string(skin.name)
            }
            if let skin = model.redemptionSkins.first(where: { $0.id == skinId }) {
                return LingGlowL10n.string(skin.name)
            }
            return skinId
        }
        return LingGlowL10n.string(
            "当前永久授权已绑定「%@」；「%@」需要单独授权，原绑定不可切换。",
            ownedNames.joined(separator: "、"),
            LingGlowL10n.string(targetSkin.name)
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 13) {
                Image(systemName: target.offerType == "skin_once" ? "paintpalette.fill" : "wand.and.stars")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(
                        LinearGradient(
                            colors: [LingGlowPalette.berry, LingGlowPalette.coral],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.title3.bold())
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(20)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let existingSkinBindingNotice {
                        Label(existingSkinBindingNotice, systemImage: "lock.shield.fill")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(11)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.orange.opacity(0.09), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }

                    purchaseSection

                    HStack(spacing: 10) {
                        Rectangle().fill(Color.primary.opacity(0.10)).frame(height: 1)
                        Text("已有授权码")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .fixedSize()
                        Rectangle().fill(Color.primary.opacity(0.10)).frame(height: 1)
                    }

                    VStack(alignment: .leading, spacing: 9) {
                        Label("直接输入授权码", systemImage: "key.fill")
                            .font(.headline)
                        Text("灵妆会先通过 Dodo 判断授权码用途，再决定解锁当前皮肤、自定义皮肤位或 VIP；不会按当前页面猜测授权类型。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 8) {
                            TextField("粘贴授权码", text: $code)
                                .textFieldStyle(.roundedBorder)
                            Button {
                                if let value = NSPasteboard.general.string(forType: .string) {
                                    code = value.trimmingCharacters(in: .whitespacesAndNewlines)
                                }
                            } label: {
                                Label("粘贴", systemImage: "doc.on.clipboard")
                            }
                            .buttonStyle(.bordered)
                        }

                        if let message = recognizedMessage {
                            VStack(alignment: .leading, spacing: 8) {
                                Label(LingGlowL10n.string(message), systemImage: "info.circle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.indigo)
                                    .fixedSize(horizontal: false, vertical: true)
                                Button(otherDestinationTitle) {
                                    dismiss()
                                    showOtherDestination()
                                }
                                .controlSize(.small)
                            }
                            .padding(9)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
                        } else if let error = model.errorMessage {
                            Label(LingGlowL10n.string(error), systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundStyle(.red)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(9)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
                        }

                        Button {
                            activate()
                        } label: {
                            Label("识别授权码并解锁", systemImage: "checkmark.seal.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(LingGlowPalette.berry)
                        .disabled(
                            code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || model.entitlement?.activationConfigured != true
                            || model.isBusy
                        )
                    }
                    .studioCard()
                }
                .padding(18)
            }
        }
        .frame(width: 560, height: 480)
        .background(
            LinearGradient(
                colors: [LingGlowPalette.pearl, LingGlowPalette.canvas],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        // Sheets are hosted by a separate AppKit presentation tree and can
        // otherwise fall back to the macOS locale while the main LingGlow
        // window is using the in-app language selection.
        .environment(\.locale, model.interfaceLocale)
        .sheet(isPresented: $showingPurchaseConsent) {
            if let product {
                PurchaseConsentSheet(
                    productName: product.name,
                    accepted: $acceptedPurchaseTerms,
                    cancel: { showingPurchaseConsent = false },
                    confirm: {
                        if let url = product.safeCheckoutURL {
                            NSWorkspace.shared.open(url)
                        }
                        showingPurchaseConsent = false
                    }
                )
            }
        }
        .task {
            if code.isEmpty { code = model.licenseInput }
            model.clearMessages()
            await model.loadProductCatalogIfNeeded()
        }
    }

    @ViewBuilder
    private var purchaseSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(target.offerType == "skin_once" ? "购买此皮肤授权" : "购买自定义皮肤位", systemImage: "cart.fill")
                .font(.headline)
            if let product {
                Text(LingGlowL10n.string(product.summary))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let reason = model.checkoutUnavailableReason(for: product) {
                    Label(LingGlowL10n.string(reason), systemImage: "exclamationmark.lock.fill")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(target.offerType == "skin_once" ? "购买此皮肤授权" : "购买自定义皮肤位") {
                    showingPurchaseConsent = true
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.checkoutUnavailableReason(for: product) != nil)
            } else if model.isProductCatalogLoading {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("正在读取购买入口…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text(LingGlowL10n.string(model.productCatalogError ?? "当前购买入口暂不可用，已有授权码仍可直接验证。"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .studioCard()
    }

    private var otherDestinationTitle: String {
        switch target {
        case .skin: return LingGlowL10n.string("前往自定义皮肤")
        case .customSlot: return LingGlowL10n.string("前往皮肤页")
        }
    }

    private func activate() {
        recognizedMessage = nil
        Task {
            guard let purpose = await model.activateLicense(code: code, context: target.activationContext) else {
                return
            }
            switch (target, purpose) {
            case (.skin(_), .vip), (.customSlot, .vip), (.customSlot, .customProfile(_)):
                dismiss()
            case let (.skin(skin), .skin(skinId)) where skin.id == skinId:
                dismiss()
            case (.skin(_), .customProfile(_)):
                recognizedMessage = "已识别为自定义皮肤位授权码，权益已安全同步；请前往自定义皮肤页使用。"
            case (.customSlot, .skin(_)):
                recognizedMessage = "已识别为单套皮肤授权码；请前往皮肤页查看或选择对应皮肤。"
            case (.skin(_), .skin(_)):
                recognizedMessage = "该授权码已绑定另一套皮肤；请回到皮肤页查看已购买皮肤。"
            case (_, .unknown):
                recognizedMessage = "授权码已验证，但返回的权益用途无法归类；请在授权页查看已同步权益。"
            }
        }
    }
}

private struct CustomSkinsView: View {
    @ObservedObject var model: StudioModel
    let showCatalogSkins: () -> Void
    @State private var showingCustomEditor = false
    @State private var showingFreeBrandEditor = false
    @State private var showingCustomUnlock = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ClientPicker(selection: $model.selectedClient)

            HStack(alignment: .top, spacing: LingGlowLayout.sectionSpacing) {
                creationCard
                identityCard
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("按 Agent 管理")
                    .font(.title3.bold())
                Text("每个 Agent 保留自己的布局能力，背景、深浅模式与可读性规则统一管理。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .top, spacing: LingGlowLayout.sectionSpacing) {
                ForEach(ClientID.allCases) { client in
                    agentCard(client)
                }
            }

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "info.circle.fill")
                    .foregroundStyle(LingGlowPalette.accent)
                Text("自定义模板会按 WorkBuddy、豆包与 Codex 的有效能力分别保存。切换深色或浅色模式时，灵妆会使用对应的字体、按钮、弹窗与输入框规则，不会把一套颜色强行覆盖到三个客户端。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(LingGlowLayout.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LingGlowPalette.accentSoft.opacity(0.28), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .sheet(isPresented: $showingCustomEditor) {
            AgentCustomEditor(model: model, initialClient: model.selectedClient)
        }
        .sheet(isPresented: $showingFreeBrandEditor) {
            FreeAppearanceEditor(model: model)
        }
        .sheet(isPresented: $showingCustomUnlock) {
            LicenseUnlockSheet(
                model: model,
                target: .customSlot,
                showOtherDestination: showCatalogSkins
            )
        }
    }

    private var creationCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "slider.horizontal.3")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(LingGlowPalette.accent)
                Text("自定义皮肤编辑器")
                    .font(.headline)
                Spacer()
                StatusPill(text: model.canEditCustomProfiles ? "可编辑" : "可预览", color: LingGlowPalette.accent)
            }
            Text("集中配置背景、首页配图、深浅模式、色板和组件样式。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 4)
            HStack {
                Button {
                    showingCustomEditor = true
                } label: {
                    Label(model.canEditCustomProfiles ? "打开编辑器" : "先预览", systemImage: "arrow.up.right")
                }
                .buttonStyle(.bordered)
                if !model.canEditCustomProfiles {
                    Button {
                        showingCustomUnlock = true
                    } label: {
                        Label("解锁自定义皮肤", systemImage: "lock.open.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(LingGlowPalette.accent)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: LingGlowLayout.featureHeight, alignment: .topLeading)
        .studioCard(padding: LingGlowLayout.cardPadding)
    }

    private var identityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Group {
                    if let image = LocalImageAsset.previewImage(from: model.freeBrand.iconImage) {
                        Image(nsImage: image).resizable().scaledToFit()
                    } else {
                        Image(systemName: "person.crop.circle.badge.sparkles")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(LingGlowPalette.accent)
                    }
                }
                .frame(width: 24, height: 24)
                Text("名称、Icon 与机器人")
                    .font(.headline)
                Spacer()
                StatusPill(text: "永久免费", color: .green)
            }
            Text(model.freeBrand.displayName.map { LingGlowL10n.string($0) }
                 ?? LingGlowL10n.string("独立管理首页名称、透明机器人图片与三端首页文案。"))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 4)
            Button {
                showingFreeBrandEditor = true
            } label: {
                Label("管理品牌素材", systemImage: "person.crop.square")
            }
            .buttonStyle(.borderedProminent)
            .tint(LingGlowPalette.accent)
        }
        .frame(maxWidth: .infinity, minHeight: LingGlowLayout.featureHeight, alignment: .topLeading)
        .studioCard(padding: LingGlowLayout.cardPadding)
    }

    private func agentCard(_ client: ClientID) -> some View {
        let value = model.status?.clients[client.rawValue]
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                ClientBrandIcon(client: client, size: 22)
                Text(client.displayName)
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(value?.installed == true ? Color.green : Color.secondary.opacity(0.35))
                    .frame(width: 8, height: 8)
            }
            Text(value?.installed == true
                 ? "\(value?.version ?? "未知版本") · \(value?.compatibility.displayLevel ?? "检测中")"
                 : "未检测到已验证的官方应用")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 4)
            Button("编辑此端模板") {
                model.selectedClient = client
                showingCustomEditor = true
            }
            .controlSize(.small)
        }
        .frame(maxWidth: .infinity, minHeight: LingGlowLayout.featureHeight, alignment: .topLeading)
        .studioCard(padding: LingGlowLayout.cardPadding)
    }
}

private struct FreeAppearanceEditor: View {
    @ObservedObject var model: StudioModel
    @Environment(\.dismiss) private var dismiss
    @State private var displayName = ""
    @State private var tagline = ""
    @State private var iconImage: String?
    @State private var composerAvatarImage: String?
    @State private var codexHomeTitle = ""
    @State private var doubaoHomeTitle = ""
    @State private var workbuddyHomeTitle = ""
    @State private var localError: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Group {
                    if let image = LocalImageAsset.previewImage(from: iconImage) {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                            .padding(6)
                    } else {
                        Text("W")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: 44, height: 44)
                .background(
                    LinearGradient(colors: [.blue, .cyan], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 11)
                )
                .clipShape(RoundedRectangle(cornerRadius: 11))

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text("免费外观覆盖")
                            .font(.headline)
                        Text("永久免费")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.green)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.green.opacity(0.11), in: Capsule())
                    }
                    Text("覆盖现有皮肤的 Icon、机器人图片和三客户端首页文案")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(18)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error = localError ?? model.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(9)
                            .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("显示名称")
                            .font(.subheadline.weight(.semibold))
                        TextField("例如：My Studio", text: $displayName)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: displayName) { value in
                                if value.count > 24 {
                                    displayName = String(value.prefix(24))
                                }
                            }
                        Text("最多 24 个字符；留空会保留皮肤自带名称或 WorkBuddy 原名。")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .studioCard()

                    LocalImagePickerCard(
                        title: "左上角 Logo / Icon",
                        detail: "建议 1:1 · 512×512 px 以上 · PNG 透明底优先 · 最大 2 MB",
                        imageDataURL: iconImage,
                        contentMode: .fit,
                        choose: chooseIcon,
                        clear: { iconImage = nil }
                    )

                    LocalImagePickerCard(
                        title: LingGlowL10n.string("三端输入框小机器人"),
                        detail: LingGlowL10n.string("同时用于 WorkBuddy、Codex、豆包的新建任务和历史对话输入框右上角；必须是透明画布上的完整独立主体，四周保留透明留白"),
                        imageDataURL: composerAvatarImage,
                        contentMode: .fit,
                        choose: chooseComposerAvatar,
                        clear: { composerAvatarImage = nil }
                    )

                    VStack(alignment: .leading, spacing: 9) {
                        Text("新建任务首页文案")
                            .font(.subheadline.weight(.semibold))
                        TextField("Codex，例如：今天在{项目}中创造什么？", text: $codexHomeTitle)
                            .textFieldStyle(.roundedBorder)
                        TextField("豆包，例如：今天想聊些什么？", text: $doubaoHomeTitle)
                            .textFieldStyle(.roundedBorder)
                        TextField("WorkBuddy 主标题", text: $workbuddyHomeTitle)
                            .textFieldStyle(.roundedBorder)
                        TextField("WorkBuddy 副标题", text: $tagline)
                            .textFieldStyle(.roundedBorder)
                        Text("Codex 文案中的 {项目} 会保留原生项目选择按钮；留空则使用当前皮肤或客户端默认文案。")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .studioCard()

                    VStack(alignment: .leading, spacing: 7) {
                        Label("这项功能不需要 VIP，也不占用自定义皮肤位。", systemImage: "checkmark.seal.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.green)
                        Text(LingGlowL10n.string("保存的是本机覆盖配置，不修改任何 Agent 安装包。保存后请重新应用当前皮肤或重启换肤流程。"))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .studioCard()
                }
                .padding(16)
            }

            Divider()

            HStack {
                Button("恢复皮肤默认", role: .destructive) { restoreOriginal() }
                    .disabled(model.isBusy)
                Spacer()
                Button("取消") { dismiss() }
                Button("保存品牌设置") { save(applyAfterSaving: false) }
                    .disabled(model.isBusy)
                Button("保存并重新应用") { save(applyAfterSaving: true) }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isBusy || model.status?.clients[model.selectedClient.rawValue]?.session.profileId == nil)
            }
            .padding(16)
        }
        .frame(width: 500, height: 610)
        .background(Color(nsColor: .windowBackgroundColor))
        // SwiftUI sheets use a separate presentation tree. Keep literal
        // LocalizedStringKey labels and LingGlowL10n dynamic labels on the
        // same in-app language instead of falling back to macOS.
        .environment(\.locale, model.interfaceLocale)
        .onAppear {
            displayName = model.freeBrand.displayName ?? ""
            tagline = model.freeBrand.tagline ?? ""
            iconImage = model.freeBrand.iconImage
            composerAvatarImage = model.freeBrand.composerAvatarImage
            codexHomeTitle = model.freeBrand.codexHomeTitle ?? ""
            doubaoHomeTitle = model.freeBrand.doubaoHomeTitle ?? ""
            workbuddyHomeTitle = model.freeBrand.workbuddyHomeTitle ?? ""
            model.clearMessages()
        }
    }

    private func chooseIcon() {
        do {
            iconImage = try LocalImageAsset.chooseBrandIcon()
            localError = nil
        } catch LocalImageAssetError.cancelled {
            return
        } catch {
            localError = (error as? LocalizedError)?.errorDescription ?? LingGlowL10n.string("无法处理所选图标")
        }
    }

    private func chooseComposerAvatar() {
        do {
            composerAvatarImage = try LocalImageAsset.chooseComposerAvatar()
            localError = nil
        } catch LocalImageAssetError.cancelled {
            return
        } catch {
            localError = (error as? LocalizedError)?.errorDescription ?? LingGlowL10n.string("无法处理所选机器人图片")
        }
    }

    private func save(applyAfterSaving: Bool) {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        localError = nil
        Task {
            if await model.saveFreeBrand(
                displayName: name.isEmpty ? nil : name,
                tagline: optionalText(tagline),
                iconImage: iconImage,
                composerAvatarImage: composerAvatarImage,
                composerAvatarMotion: nil,
                codexHomeTitle: optionalText(codexHomeTitle),
                doubaoHomeTitle: optionalText(doubaoHomeTitle),
                workbuddyHomeTitle: optionalText(workbuddyHomeTitle)
            ) {
                guard applyAfterSaving else {
                    dismiss()
                    return
                }
                guard let intent = await model.createReapplyCurrentClientIntent() else { return }
                guard presentIntentConfirmation(intent, skinName: "当前 \(model.selectedClient.displayName) 皮肤") else { return }
                await model.confirm(intent)
                if model.errorMessage == nil { dismiss() }
            }
        }
    }

    private func optionalText(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func restoreOriginal() {
        localError = nil
        Task {
            if await model.saveFreeBrand(
                displayName: nil,
                tagline: nil,
                iconImage: nil,
                composerAvatarImage: nil,
                composerAvatarMotion: nil,
                codexHomeTitle: nil,
                doubaoHomeTitle: nil,
                workbuddyHomeTitle: nil
            ) {
                dismiss()
            }
        }
    }
}

private struct AgentCustomEditor: View {
    @ObservedObject var model: StudioModel
    let initialClient: ClientID
    @Environment(\.dismiss) private var dismiss
    @State private var selectedClient: ClientID
    @State private var draft: UnionProfile?
    @State private var schema: CapabilitySchemaResponse?
    @State private var localError: String?
    @State private var selectedSlotId: String?
    @State private var codexThemeExportMessage: String?

    init(model: StudioModel, initialClient: ClientID) {
        self.model = model
        self.initialClient = initialClient
        _selectedClient = State(initialValue: initialClient)
    }

    var body: some View {
        VStack(spacing: 0) {
            editorHeader
            Divider()

            ScrollView {
                if draft != nil, let schema {
                    VStack(alignment: .leading, spacing: 14) {
                        errorBanner
                        profileSettings
                        capabilityBanner(schema)
                        if selectedClient == .codex {
                            codexOfficialThemeCard
                        }
                        previewCard

                        ForEach(fieldGroups, id: \.self) { group in
                            VStack(alignment: .leading, spacing: 9) {
                                Text(LingGlowL10n.string(group))
                                    .font(.headline)
                                ForEach(fields(in: group)) { field in
                                    fieldCard(field)
                                }
                            }
                        }

                        Label(
                            "字段来自本地宿主能力清单。未来版本的未知字段不会被原生端改写或删除；静态图片只在本机重编码。",
                            systemImage: "lock.shield"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                } else {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text(LingGlowL10n.string(model.errorMessage ?? "正在读取 Agent 能力清单…"))
                            .font(.caption)
                            .foregroundStyle(model.errorMessage == nil ? Color.secondary : Color.red)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 70)
                }
            }

            Divider()
            editorFooter
        }
        .frame(width: 560, height: 760)
        .background(Color(nsColor: .windowBackgroundColor))
        .environment(\.locale, model.interfaceLocale)
        .task { await bootstrap() }
        .onChange(of: selectedClient) { client in
            guard draft?.targetClientId != client.rawValue else { return }
            if targetAgentIsLocked,
               let lockedTarget = draft.flatMap({ ClientID(rawValue: $0.targetClientId) }) {
                // A persisted draft or a permanent custom slot represents one
                // skin.  Switching it in-place would re-purpose the same
                // profileId across Agents, so make the user open a new target
                // before creating a new profile instead.
                selectedClient = lockedTarget
                localError = "这个已保存的方案目标 Agent 已固定；不能用同一 profileId 改作其他 Agent"
                return
            }
            draft?.targetClientId = client.rawValue
            Task { await switchCapabilitySchema(to: client) }
        }
        .onChange(of: selectedSlotId) { profileId in
            guard !model.isVIP,
                  let profileId,
                  draft?.id != profileId else { return }
            Task { await switchCustomSlot(to: profileId) }
        }
    }

    private var editorHeader: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "wand.and.stars")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(
                    LinearGradient(colors: [.pink, .purple, .blue], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 11)
                )
            VStack(alignment: .leading, spacing: 3) {
                Text("自定义皮肤编辑器")
                    .font(.headline)
                Text("每个自定义位固定一个 profileId，可按目标 Agent 的真实能力编辑")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: { dismiss() }) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(18)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = localError ?? model.errorMessage {
            Label(LingGlowL10n.string(error), systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(9)
                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
        }
    }

    private var isBlockedAgent: Bool {
        guard let runtimeStatus = schema?.capabilityMap.runtimeStatus else { return false }
        return runtimeStatus == "blocked"
    }

    private var targetAgentIsLocked: Bool {
        guard let draft else { return false }
        return model.isUnionProfileTargetLocked(draft)
    }

    private var targetLockDescription: String {
        guard let draft else { return LingGlowL10n.string("目标 Agent 已固定") }
        if model.isUnionProfileDraft(draft) {
            return LingGlowL10n.string("这个不可执行设计草稿的目标 Agent 已固定；不能用同一 profileId 改作其他 Agent。")
        }
        if !model.isVIP && model.customProfileSlotIds.contains(draft.id) {
            return LingGlowL10n.string("这个永久自定义位固定为一个 profileId 和目标 Agent；不能用同一 profileId 改作其他 Agent。")
        }
        return LingGlowL10n.string("这个已保存的自定义皮肤目标 Agent 已固定；不能用同一 profileId 改作其他 Agent。")
    }

    private var canSaveBlockedDesignDraft: Bool {
        guard let profile = draft else { return false }
        return isBlockedAgent && model.canPersistCustomProfile(id: profile.id) && !model.isBusy
    }

    private var isSavedDesignDraft: Bool {
        guard let draft else { return false }
        return model.isUnionProfileDraft(draft)
    }

    private var canPromoteDesignDraft: Bool {
        guard let profile = draft else { return false }
        return isSavedDesignDraft &&
            schema?.capabilityMap.runtimeStatus == "available" &&
            model.canPersistCustomProfile(id: profile.id) &&
            !model.isBusy
    }

    private var profileSettings: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("方案")
                .font(.headline)
            if !model.isVIP, !model.customProfileSlotIds.isEmpty {
                if model.customProfileSlotIds.count > 1 {
                    Picker("已购自定义位", selection: $selectedSlotId) {
                        ForEach(model.customProfileSlotIds, id: \.self) { profileId in
                            Text(customSlotLabel(profileId)).tag(Optional(profileId))
                        }
                    }
                    .pickerStyle(.menu)
                } else {
                    HStack {
                        Label("已解锁 1 个永久自定义位", systemImage: "checkmark.seal.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.indigo)
                        Spacer()
                        Text(model.customProfileSlotIds[0])
                            .font(.caption2.monospaced())
                            .textSelection(.enabled)
                    }
                }
                Text("每个授权码只解锁一个固定 profileId；切换自定义位前请先保存当前修改。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            ClientPicker(selection: $selectedClient)
                .disabled(targetAgentIsLocked)
            if targetAgentIsLocked {
                Label(
                    targetLockDescription,
                    systemImage: "lock.fill"
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            TextField("自定义皮肤名称", text: Binding(
                get: { draft?.name ?? "" },
                set: { draft?.name = String($0.prefix(60)) }
            ))
            .textFieldStyle(.roundedBorder)
            Picker("标签分类", selection: profileLabelCategoryBinding) {
                ForEach(SkinLabelCategory.allCases) { label in
                    Text(label.title).tag(label.rawValue)
                }
            }
            .pickerStyle(.menu)
            HStack {
                Text("固定 profileId")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(draft?.id ?? "—")
                    .font(.caption2.monospaced())
                    .textSelection(.enabled)
            }
        }
        .studioCard()
    }

    private func capabilityBanner(_ schema: CapabilitySchemaResponse) -> some View {
        let available = schema.capabilityMap.runtimeStatus == "available"
        let genericSafe = model.status?.clients[selectedClient.rawValue]?.compatibility.level == "generic-safe"
        return HStack(alignment: .top, spacing: 9) {
            Image(systemName: available ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                .foregroundStyle(available ? Color.green : Color.orange)
            VStack(alignment: .leading, spacing: 3) {
                Text(LingGlowL10n.string(isBlockedAgent && canSaveBlockedDesignDraft
                     ? "不可执行设计草稿"
                     : (!available ? "当前仅支持配置预览" : (genericSafe ? "基础安全映射" : "能力映射可用"))))
                    .font(.subheadline.weight(.semibold))
                Text(LingGlowL10n.string(schema.capabilityMap.auditedTarget))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if canPromoteDesignDraft {
                    Text("该设计草稿已可显式提升为正式皮肤；提升不会自动应用或重启。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if isBlockedAgent && canSaveBlockedDesignDraft {
                    Text("可保存为不可执行设计草稿；不会注入、不会进入排程、不能应用，也不会生成可执行皮肤。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if !available {
                    Text("当前仅允许本地预览；不会注入、不会进入排程、不能应用或生成可执行皮肤。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if genericSafe {
                    Text("当前运行版本只会消费背景、色板和基础玻璃字段；候选布局与控件字段仍会原样保留，但不会编译或注入。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .studioCard()
    }

    @ViewBuilder
    private var previewCard: some View {
        if let draft, let schema {
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Text("完整本地预览")
                        .font(.headline)
                    Spacer()
                    Text(LingGlowL10n.string(saveAvailabilityLabel))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(canSave ? Color.green : Color.blue)
                }
                AgentSkinPreview(
                    profile: draft,
                    schema: schema,
                    client: selectedClient,
                    freeBrand: model.freeBrand
                )
            }
            .studioCard()
        }
    }

    /// This card is intentionally available only after the Codex union
    /// profile exists in the private executable store. It copies a public
    /// `codex-theme-v1:` string, not a renderer payload: importing it remains
    /// a deliberate action in Codex's own Appearance settings.
    @ViewBuilder
    private var codexOfficialThemeCard: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Label("Codex 官方主题", systemImage: "doc.on.clipboard")
                    .font(.headline)
                Text("手动导入")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.blue)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(Color.blue.opacity(0.11), in: Capsule())
                Spacer()
            }

            Text("复制后请在 Codex 的“设置 → 外观 → Theme”中手动导入。此操作只从已保存的本地方案生成主题文本，不会启动、连接、重启、注入或修改 Codex。")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Text("官方主题仅包含配色、字体、语义色、窗口不透明选项和代码主题 ID；背景图、Banner、布局与候选界面字段不会写入。")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if canExportCodexOfficialTheme {
                Button(action: copyCodexOfficialTheme) {
                    Label("复制官方主题字符串", systemImage: "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(model.isBusy)
            } else {
                Label("请先点击“仅保存”，再复制这套已保存的 Codex 自定义皮肤。", systemImage: "lock")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let codexThemeExportMessage {
                Label(LingGlowL10n.string(codexThemeExportMessage), systemImage: "checkmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.green)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .studioCard()
    }

    private var canExportCodexOfficialTheme: Bool {
        guard let draft,
              draft.targetClientId == ClientID.codex.rawValue else { return false }
        return model.unionProfiles.contains {
            // The backend intentionally exports by persisted profile ID, not
            // the in-memory draft. Do not let a modified-but-unsaved editor
            // look as though it has already been exported.
            $0 == draft && $0.targetClientId == ClientID.codex.rawValue
        }
    }

    private func copyCodexOfficialTheme() {
        guard let draft, canExportCodexOfficialTheme else {
            localError = LingGlowL10n.string("请先仅保存这套 Codex 自定义皮肤；未保存草稿不能导出官方主题")
            return
        }
        Task {
            guard let exported = await model.exportCodexOfficialTheme(for: draft) else { return }
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            guard pasteboard.setString(exported.themeString, forType: .string) else {
                localError = LingGlowL10n.string("无法写入系统剪贴板；方案没有被应用，也没有修改 Codex")
                return
            }
            codexThemeExportMessage = LingGlowL10n.string("已复制。请切换到 Codex 的外观设置并手动导入。")
            localError = nil
        }
    }

    private var fieldGroups: [String] {
        var result: [String] = []
        for field in schema?.editorProjection.fields ?? [] where !result.contains(field.group) {
            result.append(field.group)
        }
        return result
    }

    private func fields(in group: String) -> [CapabilityEditorField] {
        (schema?.editorProjection.fields ?? []).filter { $0.group == group }
    }

    private func fieldCard(_ field: CapabilityEditorField) -> some View {
        let editable = canEdit(field)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(LingGlowL10n.string(field.description))
                    .font(.subheadline.weight(.semibold))
                Spacer()
                StatusPill(
                    text: editable ? (field.editable ? "可编辑" : "草稿可编辑") : supportLabel(field.supportStatus),
                    color: editable ? .green : (field.supportStatus == "pending" ? .orange : .secondary)
                )
            }
            fieldEditor(field)
                .disabled(!editable)
            Text(field.id)
                .font(.caption2.monospaced())
                .foregroundStyle(.tertiary)
            if !editable {
                Text(LingGlowL10n.string(field.supportDescription))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .studioCard()
    }

    /// Pending fields for a blocked Agent are editable only as a paid,
    /// non-executable design draft. This does not alter the backend capability
    /// map: runtime compilation and injection remain unavailable.
    private func canEdit(_ field: CapabilityEditorField) -> Bool {
        if isSavedDesignDraft && !isBlockedAgent { return false }
        return field.editable || canSaveBlockedDesignDraft
    }

    @ViewBuilder
    private func fieldEditor(_ field: CapabilityEditorField) -> some View {
        switch field.type {
        case "boolean":
            Toggle("启用", isOn: Binding(
                get: { value(for: field).boolValue ?? false },
                set: { setValue(.bool($0), for: field) }
            ))
        case "string", "color":
            HStack {
                if field.type == "color" {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color(hex: value(for: field).stringValue ?? "#808080"))
                        .frame(width: 28, height: 24)
                }
                TextField(field.type == "color" ? "#RRGGBB" : "留空使用默认值", text: stringBinding(for: field))
                    .textFieldStyle(.roundedBorder)
            }
        case "number", "integer":
            let minimum = field.minimum ?? 0
            let maximum = field.maximum ?? 100
            HStack {
                Slider(
                    value: numberBinding(for: field),
                    in: minimum...maximum,
                    step: field.type == "integer" ? 1 : 0.01
                )
                Text(field.type == "integer"
                     ? String(Int(value(for: field).numberValue ?? minimum))
                     : String(format: "%.2f", value(for: field).numberValue ?? minimum))
                    .font(.caption.monospacedDigit())
                    .frame(width: 48, alignment: .trailing)
            }
        case "enum":
            Picker("", selection: stringBinding(for: field)) {
                ForEach(field.optionValues, id: \.self) { option in
                    Text(optionLabel(option)).tag(option)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
        case "asset":
            LocalImagePickerCard(
                title: assetTitle(for: field),
                detail: assetGuidance(for: field),
                imageDataURL: value(for: field).stringValue,
                contentMode: assetContentMode(for: field),
                choose: { chooseAsset(for: field) },
                clear: { setValue(.null, for: field) }
            )
        default:
            Label("此字段类型需要更新原生编辑器；当前值会原样保留。", systemImage: "archivebox")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var editorFooter: some View {
        HStack {
            Button("取消") { dismiss() }
            Spacer()
            if let profile = draft, !model.canPersistCustomProfile(id: profile.id) {
                Label("免费版仅预览", systemImage: "eye")
                    .font(.caption)
                    .foregroundStyle(.blue)
            } else if canSaveBlockedDesignDraft {
                Label("仅设计草稿 · 不能应用", systemImage: "lock.shield.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else if schema?.capabilityMap.runtimeStatus != "available" {
                Label("此 Agent 仅预览", systemImage: "shield.lefthalf.filled")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else if !model.isVIP, draft != nil {
                Label("永久自定义位", systemImage: "checkmark.seal.fill")
                    .font(.caption)
                    .foregroundStyle(.indigo)
            }
            if canPromoteDesignDraft {
                Button("提升为可执行皮肤") { promoteDraft() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canPromoteDesignDraft)
            } else {
                Button(isBlockedAgent ? "保存不可执行草稿" : "仅保存") { save(applyAfterSaving: false) }
                    .disabled(!canSave)
            }
            Button("保存并应用") { save(applyAfterSaving: true) }
                .buttonStyle(.borderedProminent)
                .disabled(isBlockedAgent || isSavedDesignDraft || !canApply)
        }
        .padding(16)
    }

    private var canSave: Bool {
        guard let profile = draft,
              let runtimeStatus = schema?.capabilityMap.runtimeStatus else { return false }
        guard runtimeStatus == "available" || runtimeStatus == "blocked" else { return false }
        if isSavedDesignDraft && runtimeStatus == "available" { return false }
        return model.canPersistCustomProfile(id: profile.id) && !model.isBusy
    }

    private var previewOnlyLabel: String {
        if canSaveBlockedDesignDraft {
            return LingGlowL10n.string("可保存草稿")
        }
        if schema?.capabilityMap.runtimeStatus != "available" {
            return LingGlowL10n.string("此 Agent · 仅预览")
        }
        return LingGlowL10n.string("免费版 · 仅预览")
    }

    private var saveAvailabilityLabel: String {
        canSave ? (canSaveBlockedDesignDraft ? LingGlowL10n.string("可保存草稿") : LingGlowL10n.string("可保存")) : previewOnlyLabel
    }

    private var canApply: Bool {
        guard canSave,
              !isBlockedAgent,
              schema?.capabilityMap.runtimeStatus == "available",
              let client = ClientID(rawValue: draft?.targetClientId ?? "") else { return false }
        let status = model.status?.clients[client.rawValue]
        return status?.installed == true && status?.compatibility.advancedAllowed == true
    }

    private func value(for field: CapabilityEditorField) -> JSONValue {
        draft?.values[field.id] ?? field.value
    }

    private func setValue(_ value: JSONValue, for field: CapabilityEditorField) {
        guard canEdit(field) else { return }
        draft?.values[field.id] = value
        if field.id != "advanced.enabled" {
            draft?.values["advanced.enabled"] = .bool(true)
        }
        localError = nil
    }

    private func stringBinding(for field: CapabilityEditorField) -> Binding<String> {
        Binding(
            get: { value(for: field).stringValue ?? "" },
            set: { value in
                let limited = String(value.prefix(field.type == "color" ? 7 : 80))
                if limited.isEmpty, field.constraints["nullable"]?.boolValue == true {
                    setValue(.null, for: field)
                } else {
                    setValue(.string(limited), for: field)
                }
            }
        )
    }

    private func numberBinding(for field: CapabilityEditorField) -> Binding<Double> {
        Binding(
            get: { value(for: field).numberValue ?? field.minimum ?? 0 },
            set: { value in
                setValue(.number(field.type == "integer" ? value.rounded() : value), for: field)
            }
        )
    }

    private var profileLabelCategoryBinding: Binding<String> {
        Binding(
            get: {
                draft?.values["metadata.labelCategory"]?.stringValue
                    ?? SkinLabelCategory.other.rawValue
            },
            set: { value in
                guard SkinLabelCategory(rawValue: value) != nil else { return }
                draft?.values["metadata.labelCategory"] = .string(value)
                localError = nil
            }
        )
    }

    private func supportLabel(_ status: String) -> String {
        switch status {
        case "pending": return LingGlowL10n.string("候选")
        case "unsupported": return LingGlowL10n.string("不支持")
        default: return LingGlowL10n.string("只读")
        }
    }

    private func optionLabel(_ option: String) -> String {
        switch option {
        case "cover": return LingGlowL10n.string("填充裁切")
        case "contain": return LingGlowL10n.string("完整显示")
        case "center": return LingGlowL10n.string("居中")
        case "top": return LingGlowL10n.string("顶部")
        case "bottom": return LingGlowL10n.string("底部")
        case "left": return LingGlowL10n.string("左侧")
        case "right": return LingGlowL10n.string("右侧")
        case "light": return LingGlowL10n.string("浅色")
        case "dark": return LingGlowL10n.string("深色")
        case "none": return LingGlowL10n.string("无")
        case "subtle": return LingGlowL10n.string("轻柔")
        case "still": return LingGlowL10n.string("静止")
        case "float": return LingGlowL10n.string("漂浮")
        case "roll": return LingGlowL10n.string("滚动")
        case "hop": return LingGlowL10n.string("跳跃")
        default: return option
        }
    }

    private func assetContentMode(for field: CapabilityEditorField) -> ContentMode {
        let fitField = field.id.replacingOccurrences(of: ".image", with: ".fit")
        return draft?.values[fitField]?.stringValue == "contain" ? .fit : .fill
    }

    private func assetTitle(for field: CapabilityEditorField) -> String {
        switch field.id {
        case "background.image": return LingGlowL10n.string("全局默认背景")
        case "codex.banner.image": return LingGlowL10n.string("Codex 新建任务主视觉")
        case "workbuddy.projectHero.image": return LingGlowL10n.string("WorkBuddy 项目 Hero")
        case "workbuddy.composerAvatar.image": return LingGlowL10n.string("三端新建/历史输入框机器人")
        case "brand.iconImage": return LingGlowL10n.string("品牌 Logo / Icon")
        case "doubao.homeHero.image": return LingGlowL10n.string("豆包首页 Hero")
        case "doubao.assistantAvatar.image": return LingGlowL10n.string("豆包助手头像")
        default: return LingGlowL10n.string("本地静态图片")
        }
    }

    private func assetGuidance(for field: CapabilityEditorField) -> String {
        switch field.id {
        case "background.image":
            return LingGlowL10n.string("建议 16:10 · 2560×1600 px · 最大 4 MB / 4096 px / 16 MP")
        case "codex.banner.image":
            return LingGlowL10n.string("建议 3:1 · 2400×800 px · 最大 4 MB / 4096 px / 16 MP")
        case "workbuddy.projectHero.image", "doubao.homeHero.image":
            return LingGlowL10n.string("建议 16:9 · 1920×1080 px · 最大 4 MB / 4096 px / 16 MP")
        case "brand.iconImage":
            return LingGlowL10n.string("建议 1:1 · 512×512 px 以上 · 最大 2 MB / 2048 px / 4 MP")
        case "workbuddy.composerAvatar.image", "doubao.assistantAvatar.image":
            return field.id == "workbuddy.composerAvatar.image"
                ? LingGlowL10n.string("用于 WorkBuddy、Codex、豆包的新建任务与历史对话；必须是透明画布上的完整独立主体并在四周留白")
                : LingGlowL10n.string("建议 1:1 · 1024×1024 px 以内 · 最大 2 MB / 2048 px / 4 MP")
        default:
            return LingGlowL10n.string("PNG / JPG / JPEG / WebP 静态图 · 最大 4 MB")
        }
    }

    private func chooseAsset(for field: CapabilityEditorField) {
        do {
            let image: String
            if field.id == "workbuddy.composerAvatar.image" {
                image = try LocalImageAsset.chooseComposerAvatar()
            } else if field.id.contains("brand.icon") || field.id.contains("assistantAvatar") {
                image = try LocalImageAsset.chooseBrandIcon()
            } else if field.id == "workbuddy.projectHero.image" {
                image = try LocalImageAsset.chooseProjectHero()
            } else {
                image = try LocalImageAsset.chooseBackground()
            }
            setValue(.string(image), for: field)
        } catch LocalImageAssetError.cancelled {
            return
        } catch {
            localError = (error as? LocalizedError)?.errorDescription ?? LingGlowL10n.string("无法处理所选图片")
        }
    }

    private func bootstrap() async {
        guard draft == nil else { return }
        selectedClient = initialClient
        guard let profile = await model.customEditorProfile(for: initialClient) else { return }
        draft = profile
        let target = ClientID(rawValue: profile.targetClientId) ?? initialClient
        selectedClient = target
        if let cached = model.capabilitySchemas[target] {
            schema = cached
        } else {
            schema = await model.loadCapabilitySchema(for: target)
        }
        if !model.isVIP, model.customProfileSlotIds.contains(profile.id) {
            selectedSlotId = profile.id
        }
    }

    private func switchCustomSlot(to profileId: String) async {
        guard model.customProfileSlotIds.contains(profileId),
              let profile = await model.customEditorProfile(
                for: selectedClient,
                preferredProfileId: profileId
              ),
              selectedSlotId == profileId else { return }
        draft = profile
        let target = ClientID(rawValue: profile.targetClientId) ?? selectedClient
        selectedClient = target
        if let cached = model.capabilitySchemas[target] {
            schema = cached
        } else {
            schema = await model.loadCapabilitySchema(for: target)
        }
        localError = nil
    }

    private func customSlotLabel(_ profileId: String) -> String {
        let position = (model.customProfileSlotIds.firstIndex(of: profileId) ?? 0) + 1
        let name = model.unionProfiles.first(where: { $0.id == profileId })?.name
            ?? model.unionProfileDrafts.first(where: { $0.id == profileId })?.name
        return "\(name ?? "自定义位 \(position)") · \(profileId)"
    }

    private func switchCapabilitySchema(to client: ClientID) async {
        guard let loaded = await model.loadCapabilitySchema(for: client), selectedClient == client else { return }
        schema = loaded
    }

    private func promoteDraft() {
        guard let draft, canPromoteDesignDraft else { return }
        guard presentDraftPromotionConfirmation(draft) else { return }
        Task {
            guard let promoted = await model.promoteUnionProfileDraft(draft) else { return }
            self.draft = promoted
            localError = nil
            // Deliberately do not create an apply intent here. The explicit
            // promotion only changes which private store owns the profile.
        }
    }

    private func save(applyAfterSaving: Bool) {
        guard var profile = draft else { return }
        guard !(isSavedDesignDraft && !isBlockedAgent) else {
            localError = LingGlowL10n.string("该设计草稿已可提升为正式皮肤；请使用“提升为可执行皮肤”，不会自动应用")
            return
        }
        guard !(isBlockedAgent && applyAfterSaving) else {
            localError = LingGlowL10n.string("不可执行设计草稿不能应用；当前不会启动、重启或注入 %@", selectedClient.displayName)
            return
        }
        let trimmed = profile.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            localError = LingGlowL10n.string("请输入自定义皮肤名称")
            return
        }
        guard model.canPersistCustomProfile(id: profile.id) else {
            localError = LingGlowL10n.string("免费版可以完整预览；保存和应用需要 VIP 或绑定此 profileId 的自定义位")
            return
        }
        profile.name = String(trimmed.prefix(60))
        if targetAgentIsLocked,
           profile.targetClientId != selectedClient.rawValue {
            localError = "这个已保存方案的目标 Agent 已固定，不能用同一 profileId 改作其他 Agent"
            return
        }
        profile.targetClientId = selectedClient.rawValue
        draft = profile
        localError = nil
        Task {
            guard let saved = await model.saveUnionProfile(profile) else { return }
            draft = saved
            if !applyAfterSaving {
                if selectedClient == .codex {
                    codexThemeExportMessage = LingGlowL10n.string("已保存。现在可以复制官方主题字符串，并在 Codex 中手动导入。")
                    return
                }
                dismiss()
                return
            }
            guard let intent = await model.createApplyIntent(for: saved) else { return }
            guard presentIntentConfirmation(intent, skinName: saved.name) else { return }
            await model.confirm(intent)
            if model.errorMessage == nil { dismiss() }
        }
    }
}

private struct LocalImagePickerCard: View {
    let title: String
    let detail: String
    let imageDataURL: String?
    let contentMode: ContentMode
    let choose: () -> Void
    let clear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(LingGlowL10n.string(title))
                        .font(.subheadline.weight(.semibold))
                    Text(LingGlowL10n.string(detail))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if imageDataURL != nil {
                    Button("清除", action: clear)
                        .controlSize(.small)
                }
            }

            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.primary.opacity(0.045))
                if let image = LocalImageAsset.previewImage(from: imageDataURL) {
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                } else {
                    VStack(spacing: 5) {
                        Image(systemName: "photo.badge.plus")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                        Text("尚未选择图片")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(height: 120)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))

            Button(action: choose) {
                Label(LingGlowL10n.string(imageDataURL == nil ? "选择本地图片" : "更换图片"), systemImage: "folder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .studioCard()
    }
}

private struct SkinCard: View {
    let skin: CatalogSkin
    let active: Bool
    let locked: Bool
    let canApply: Bool
    let compatibilityWarning: Bool
    /// The server has already intersected the detected renderer version,
    /// adapter and capability allowlist.  Source artwork in a Theme Pack is
    /// not enough to call a feature delivered.
    let effectiveCapabilities: Set<String>
    let compatibilityLevel: String?
    let clientName: String
    let owned: Bool
    let showAgentBadges: Bool
    let busy: Bool
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(skinGradient)
                .overlay {
                    if let artwork = skin.previewArtwork {
                        CachedLocalArtwork(
                            dataURL: artwork,
                            cacheID: "\(skin.id):\(skin.packageVersion ?? "bundled")"
                        )
                            .overlay {
                                LinearGradient(
                                    colors: [Color(hex: skin.colors.surface).opacity(0.08), Color(hex: skin.colors.surface).opacity(0.62)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            }
                    } else if let rawURL = skin.previewArtworkURL,
                              let url = URL(string: rawURL) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case let .success(image):
                                image
                                    .resizable()
                                    .scaledToFill()
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .clipped()
                            case .failure:
                                Image(systemName: "photo")
                                    .foregroundStyle(.white.opacity(0.7))
                            default:
                                ProgressView().controlSize(.small)
                            }
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 6) {
                        Text(skin.isVIP ? "VIP" : "FREE")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background((skin.isVIP ? Color.orange : Color.green).opacity(0.92), in: Capsule())
                        if active {
                            Label("使用中", systemImage: "checkmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .background(.black.opacity(0.55), in: Capsule())
                        }
                    }
                    .padding(10)
                }
                .overlay(alignment: .bottomTrailing) {
                    Circle()
                        .fill(Color(hex: skin.colors.accent))
                        .frame(width: 20, height: 20)
                        .overlay(Circle().stroke(.white.opacity(0.65), lineWidth: 1))
                        .padding(7)
                }
                .frame(maxWidth: .infinity)
                .frame(height: LingGlowLayout.skinPreviewHeight)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(LingGlowL10n.string(skin.name))
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                        Text(LingGlowL10n.string(skin.description))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    Button(action: action) {
                        if active {
                            Label("应用到…", systemImage: "checkmark")
                        } else if locked {
                            Label("解锁", systemImage: "lock.open.fill")
                        } else if skin.needsDownloadOrUpdate {
                            Label(LingGlowL10n.string(skin.updateAvailable == true ? "更新" : "下载"), systemImage: "arrow.down")
                        } else {
                            Text("应用")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(active ? Color.green : LingGlowPalette.ink)
                    .controlSize(.small)
                    .disabled(
                        busy ||
                            (skin.isInstalled && !locked && !canApply)
                    )
                    .help(compatibilityWarning
                          ? LingGlowL10n.string("可能存在适配问题；皮肤仍可尝试应用，未适配能力会自动降级。")
                          : "")
                }
                // Keep delivery labels on their own compact row. Theme Packs
                // commonly contain three source features, and cramming their
                // truthful statuses beside a long Chinese pack name makes the
                // menu-bar card unreadable.
                if showAgentBadges {
                    HStack(spacing: 5) {
                        ForEach(skin.clientIds, id: \.self) { clientId in
                            Text(LingGlowL10n.string(clientId == "codex" ? "Codex/GPT" : (clientId == "workbuddy" ? "WorkBuddy" : "豆包")))
                                .font(.system(size: 9, weight: .semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Color.primary.opacity(0.07), in: Capsule())
                        }
                        Spacer()
                        if skin.updateAvailable == true {
                            Label("有更新", systemImage: "arrow.down.circle.fill")
                                .foregroundStyle(.orange)
                        } else if skin.isInstalled {
                            Label("已下载", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        } else if owned {
                            Label("已购买", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(LingGlowPalette.berry)
                        }
                    }
                    .font(.system(size: 9, weight: .semibold))
                }
                HStack(spacing: 4) {
                    if let rawLabel = skin.labelCategory,
                       let label = SkinLabelCategory(rawValue: rawLabel) {
                        Text(label.title)
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(LingGlowPalette.berry)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(LingGlowPalette.accentSoft, in: Capsule())
                    }
                    if skin.includesBundledArtwork {
                        featureBadge("ART", capability: "background", sourceDescription: "包含经过校验的本地图片素材")
                    }
                    if skin.includesProjectHero {
                        featureBadge("HERO", capability: "project-hero", sourceDescription: "包含 WorkBuddy 项目页 Hero 素材")
                    }
                    if skin.includesComposerAvatar {
                        featureBadge("MASCOT", capability: "composer-avatar", sourceDescription: LingGlowL10n.string("包含三端新建任务与历史对话输入框机器人"))
                    }
                    if skin.includesCustomBrand {
                        featureBadge("BRAND", capability: "brand", sourceDescription: "包含名称、标记与组件级主题")
                    }
                    if skin.includesBanner {
                        featureBadge("BANNER", capability: "banner", sourceDescription: "包含 Codex Banner 素材")
                    }
                }
                if skin.needsDownloadOrUpdate, let bytes = skin.downloadBytes {
                    Text(LingGlowL10n.string(
                        "%@ · %@",
                        LingGlowL10n.string(skin.updateAvailable == true ? "可更新" : "未下载"),
                        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
                    ))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if compatibilityWarning && !locked {
                    Text("皮肤可应用 · \(clientName) 可能存在适配问题，未适配能力会自动降级")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, minHeight: LingGlowLayout.skinCardHeight, alignment: .top)
        .background(LingGlowPalette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.primary.opacity(0.08)))
    }

    private var skinGradient: LinearGradient {
        let accent = Color(hex: skin.colors.accent)
        let surface = Color(hex: skin.colors.surface)
        let extra: Color
        switch skin.preview.gradientPreset {
        case "aurora": extra = .cyan
        case "jade": extra = .mint
        case "ocean": extra = .blue
        case "sunset": extra = .orange
        case "violet": extra = .purple
        default: extra = .gray
        }
        return LinearGradient(colors: [surface, accent.opacity(0.82), extra], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private enum FeatureDelivery {
        case supported
        case deferred
        case designPreview
        case compatibilityWarning

        var badgeSuffix: String {
            switch self {
            case .supported: return LingGlowL10n.string("可用")
            case .deferred: return LingGlowL10n.string("待适配")
            case .designPreview: return LingGlowL10n.string("预览")
            case .compatibilityWarning: return LingGlowL10n.string("可能不适配")
            }
        }

        var color: Color {
            switch self {
            case .supported: return .green
            case .deferred: return .orange
            case .designPreview: return .blue
            case .compatibilityWarning: return .orange
            }
        }
    }

    private func delivery(for capability: String) -> FeatureDelivery {
        // Doubao catalog cards deliberately remain a local design preview,
        // regardless of which source assets a pack carries.
        if skin.isDesignPreviewOnly { return .designPreview }
        if effectiveCapabilities.contains(capability) { return .supported }
        // No discovered runtime does not make a Theme Pack feature supported;
        // it needs an evidence-backed adapter before it can be delivered.
        guard let compatibilityLevel else { return .compatibilityWarning }
        if compatibilityLevel == "blocked" { return .compatibilityWarning }
        // This is the Codex generic-safe case: Banner/Brand may be present in
        // the source profile but have been intentionally removed from the
        // effective capability intersection.
        return .deferred
    }

    @ViewBuilder
    private func featureBadge(_ title: String, capability: String, sourceDescription: String) -> some View {
        let state = delivery(for: capability)
        Text("\(title) · \(state.badgeSuffix)")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(state.color)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(state.color.opacity(0.11), in: Capsule())
            .help(featureHelp(title, state: state, sourceDescription: sourceDescription))
    }

    private func featureHelp(_ title: String, state: FeatureDelivery, sourceDescription: String) -> String {
        switch state {
        case .supported:
            return LingGlowL10n.string("%@。当前 %@ 的有效能力映射已包含 %@，应用时会生效。", LingGlowL10n.string(sourceDescription), clientName, title)
        case .deferred:
            return LingGlowL10n.string("%@。当前 %@ 的有效能力映射未包含 %@，不会在应用结果中出现；需完成精确适配后才可使用。", LingGlowL10n.string(sourceDescription), clientName, title)
        case .designPreview:
            return LingGlowL10n.string("%@。当前仅用于本地设计预览；不会启动、连接或注入 %@。", LingGlowL10n.string(sourceDescription), clientName)
        case .compatibilityWarning:
            return LingGlowL10n.string("%@。目标 Agent 可能存在适配问题；皮肤仍可应用，未适配功能会自动降级。", LingGlowL10n.string(sourceDescription))
        }
    }
}

private struct CachedLocalArtwork: View {
    let dataURL: String
    let cacheID: String
    @State private var image: NSImage?

    private var cacheIdentity: String {
        "catalog:\(cacheID):800"
    }

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
            } else {
                Color.clear
            }
        }
        .task(id: cacheIdentity) {
            image = nil
            let decoded = await LocalImageAsset.previewImageAsync(
                from: dataURL,
                cacheIdentity: cacheID,
                maximumPixelSize: 800
            )
            guard !Task.isCancelled else { return }
            image = decoded
        }
    }
}

private struct ScheduleView: View {
    @ObservedObject var model: StudioModel
    let showAccount: () -> Void

    var body: some View {
        let scheduleSkinOptions = model.scheduleSkinOptions(for: model.selectedClient)
        VStack(alignment: .leading, spacing: 14) {
            ClientPicker(selection: $model.selectedClient, clients: ClientID.schedulableCases)

            if !selectedClientCanSchedule {
                scheduleRuntimeBlockedNotice
            }

            if !model.isVIP {
                HStack(spacing: 10) {
                    Image(systemName: "calendar.badge.exclamationmark")
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("七日排程属于 VIP")
                            .font(.subheadline.weight(.semibold))
                        Text("可以查看现有安排；保存和登录提醒需要有效授权。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("查看授权", action: showAccount)
                        .controlSize(.small)
                }
                .studioCard()
            }

            if model.schedule != nil {
                VStack(spacing: 10) {
                    Toggle("启用七日排程", isOn: Binding(
                        get: { model.schedule?.enabled ?? false },
                        set: { model.setScheduleEnabled($0) }
                    ))
                    Toggle("应用启动时提醒", isOn: Binding(
                        get: { model.schedule?.remindOnLaunch ?? true },
                        set: { model.setScheduleReminders($0) }
                    ))
                    Text("检测到已通过安全换肤验证的 Agent 当天首次运行后，灵妆会先询问是否进入重启确认；不会静默切换。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Text("时区")
                        Spacer()
                        Picker("时区", selection: Binding(
                            get: { model.schedule?.timeZone ?? TimeZone.current.identifier },
                            set: { model.setScheduleTimeZone($0) }
                        )) {
                            ForEach(timeZoneOptions, id: \.self) { zone in
                                Text(zone == TimeZone.current.identifier ? "本机 · \(zone)" : zone)
                                    .tag(zone)
                            }
                        }
                        .labelsHidden()
                        .frame(maxWidth: 230)
                    }
                }
                .disabled(!model.isVIP || model.isBusy || !selectedClientCanSchedule)
                .studioCard()

                VStack(spacing: 0) {
                    ForEach(Array(Weekday.allCases.enumerated()), id: \.element.id) { index, day in
                        HStack {
                            Text(day.shortName)
                                .font(.subheadline.weight(.medium))
                                .frame(width: 42, alignment: .leading)
                            Picker(day.shortName, selection: skinBinding(for: day)) {
                                Text("当天不安排").tag("")
                                ForEach(scheduleSkinOptions) { skin in
                                    Text(skin.menuLabel).tag(skin.id)
                                }
                            }
                            .labelsHidden()
                            .frame(maxWidth: .infinity)
                        }
                        .padding(.vertical, 8)
                        if index < Weekday.allCases.count - 1 { Divider() }
                    }
                }
                .padding(.horizontal, 12)
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Color.primary.opacity(0.07)))
                .disabled(!model.isVIP || model.isBusy || !selectedClientCanSchedule)

                Button {
                    Task { await model.saveSchedule() }
                } label: {
                    Label("保存七日排程", systemImage: "calendar.badge.checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.isVIP || model.isBusy || !selectedClientCanSchedule)
            } else {
                ProgressView("正在读取排程…")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)
            }
        }
    }

    private var selectedClientCanSchedule: Bool {
        model.selectedStatus?.installed == true &&
            model.selectedStatus?.compatibility.advancedAllowed == true
    }

    private var scheduleRuntimeBlockedNotice: some View {
        let reason = model.selectedStatus?.compatibility.reason
            ?? "该 Agent 尚未完成安全换肤验证。"
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 3) {
                Text("当前不能为 \(model.selectedClient.displayName) 安排自动切换")
                    .font(.subheadline.weight(.semibold))
                Text("排程结构已保留该 Agent 的七天位置；在运行时适配通过前，灵妆不会保存可执行的皮肤安排，也不会弹出重启提醒。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(reason)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .studioCard()
    }

    private var timeZoneOptions: [String] {
        var result: [String] = []
        for zone in [model.schedule?.timeZone, TimeZone.current.identifier, "Asia/Shanghai", "UTC"].compactMap({ $0 }) {
            if !result.contains(zone) { result.append(zone) }
        }
        return result
    }

    private func skinBinding(for day: Weekday) -> Binding<String> {
        Binding(
            get: { model.scheduledSkin(for: model.selectedClient, day: day) ?? "" },
            set: { model.setScheduledSkin($0.isEmpty ? nil : $0, for: model.selectedClient, day: day) }
        )
    }
}

private struct ContactSupportView: View {
    @StateObject private var store = ContactQRCodeStore()
    @State private var emailCopied = false
    private let supportEmail = "jadename.zhou@gmail.com"
    private let supportEmailURL = URL(string: "mailto:jadename.zhou@gmail.com")!
    private let columns = [
        GridItem(.adaptive(minimum: 310, maximum: 500), spacing: LingGlowLayout.sectionSpacing)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: LingGlowLayout.sectionSpacing) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.title2)
                    .foregroundStyle(LingGlowPalette.berry)
                VStack(alignment: .leading, spacing: 4) {
                    Text("交流与咨询")
                        .font(.headline)
                    Text("二维码由 GitHub 动态加载，不写入灵妆安装包。成功加载后会在本机缓存，断网时仍可查看上次版本。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Link(destination: supportEmailURL) {
                            Label(supportEmail, systemImage: "envelope.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(LingGlowPalette.berry)
                        }
                        .buttonStyle(.plain)
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(supportEmail, forType: .string)
                            emailCopied = true
                            Task { @MainActor in
                                try? await Task.sleep(nanoseconds: 1_500_000_000)
                                emailCopied = false
                            }
                        } label: {
                            Label {
                                Text(LingGlowL10n.string(emailCopied ? "已复制" : "复制"))
                            } icon: {
                                Image(systemName: emailCopied ? "checkmark" : "doc.on.doc")
                            }
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(emailCopied ? Color.green : LingGlowPalette.berry)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer()
                StatusPill(text: "GitHub 实时资源", color: .green)
            }
            .studioCard(padding: LingGlowLayout.cardPadding)

            if store.isLoading && store.codes.isEmpty {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("正在从 GitHub 读取咨询二维码…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 120)
                .studioCard()
            } else if store.codes.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 30))
                        .foregroundStyle(.orange)
                    Text(store.errorMessage ?? LingGlowL10n.string("咨询二维码暂不可用。"))
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("重新从 GitHub 读取") {
                        Task { await store.refresh() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(LingGlowPalette.berry)
                }
                .frame(maxWidth: .infinity, minHeight: 190)
                .studioCard()
            } else {
                if let message = store.errorMessage {
                    Label(message, systemImage: "externaldrive.badge.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 4)
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: LingGlowLayout.sectionSpacing) {
                    ForEach(store.codes) { code in
                        contactCard(code)
                    }
                }
                HStack {
                    Text("群二维码可能定期更新；本页每次打开灵妆时都会优先读取 GitHub 最新版。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        Label("从 GitHub 刷新", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .disabled(store.isLoading)
                }
                .padding(.horizontal, 4)
            }
        }
        .task { await store.loadIfNeeded() }
    }

    private func contactCard(_ code: ContactQRCode) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(code.title)
                    .font(.headline)
                Spacer()
                if code.id == "group" {
                    StatusPill(text: code.isExpired ? "已过期，等待 GitHub 更新" : "交流群", color: code.isExpired ? .orange : .green)
                } else {
                    StatusPill(text: "一对一", color: LingGlowPalette.berry)
                }
            }
            Image(nsImage: code.image)
                .resizable()
                .interpolation(.none)
                .scaledToFit()
                .frame(maxWidth: .infinity, minHeight: 300, maxHeight: 460)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityLabel(Text(code.title))
            Text(code.note)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .studioCard(padding: LingGlowLayout.cardPadding)
    }
}

private struct AccountView: View {
    @ObservedObject var model: StudioModel
    let showCatalogSkins: () -> Void
    @State private var acceptedPurchaseTerms = false
    @State private var showingAgreementPrompt = false
    @State private var pendingCheckoutURL: URL?
    @State private var pendingProductName = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            entitlementCard

            VStack(alignment: .leading, spacing: 9) {
                Toggle("我已阅读并同意《购买说明》和《隐私政策》", isOn: $acceptedPurchaseTerms)
                    .font(.subheadline.weight(.semibold))
                Text("灵妆销售的是即时交付的数字授权与虚拟服务。除适用法律或 Dodo Payments 规则另有规定外，购买后不支持退货退款。")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("查看购买说明") { NSWorkspace.shared.open(LingGlowLegalLinks.purchaseTerms) }
                    Button("查看隐私政策") { NSWorkspace.shared.open(LingGlowLegalLinks.privacy) }
                    Button("Dodo 隐私政策") { NSWorkspace.shared.open(LingGlowLegalLinks.dodoPrivacy) }
                }
                .controlSize(.small)
            }
            .studioCard()

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Dodo Payments 商品", systemImage: "creditcard.fill")
                        .font(.headline)
                    Spacer()
                    Text(model.productCatalog.map { "\($0.products.count) 项 · 动态目录" }
                         ?? (model.isProductCatalogLoading ? "正在读取" : "暂未载入"))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                if model.productCatalog?.commerce.usesTestProductDirectory == true {
                    Label(
                        "当前四个 Dodo Product ID 均属于测试环境，所有购买按钮已停用；只有替换为已签名的 Live 商品目录后才会开放。",
                        systemImage: "testtube.2"
                    )
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(9)
                    .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
                }

                if let products = model.productCatalog?.products, !products.isEmpty {
                    ForEach(products) { product in
                        DodoProductCard(
                            product: product,
                            unavailableReason: model.checkoutUnavailableReason(for: product)
                        ) {
                            guard let url = product.safeCheckoutURL else { return }
                            if acceptedPurchaseTerms {
                                NSWorkspace.shared.open(url)
                            } else {
                                pendingCheckoutURL = url
                                pendingProductName = product.name
                                showingAgreementPrompt = true
                            }
                        }
                    }
                } else if model.isProductCatalogLoading {
                    HStack(spacing: 9) {
                        ProgressView().controlSize(.small)
                        Text("正在读取本机商品目录…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(10)
                } else {
                    HStack(alignment: .top, spacing: 9) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text(LingGlowL10n.string(model.productCatalogError ?? "本地宿主尚未返回商品目录"))
                            .font(.caption)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .studioCard()

            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "lock.shield.fill")
                    .foregroundStyle(.indigo)
                VStack(alignment: .leading, spacing: 3) {
                    Text("永久绑定规则")
                        .font(.subheadline.weight(.semibold))
                    Text("授权记录保存在本机 AES-256-GCM 加密文件，加密主密钥存入 macOS 钥匙串。退款、拒付、取消订阅或 Dodo 撤销授权后，下一次联网验证会停止对应使用权。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .studioCard()

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("兑换或同步授权码", systemImage: "key.fill")
                        .font(.headline)
                    Spacer()
                    StatusPill(
                        text: model.entitlement?.activationConfigured == true ? "Dodo 公共验证可用" : "尚未开放",
                        color: model.entitlement?.activationConfigured == true ? .green : .orange
                    )
                }
                Text("授权码仅经本机 127.0.0.1 组件直接发送到 Dodo 公共 License API；无需商户 API Key 或 Webhook。原始授权码和激活实例仅保存在本机加密授权库，灵妆不收集银行卡信息。Dodo 按 License 激活实例统计设备数并执行商品的激活上限；客户端公共校验接口不返回总设备数。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    TextField("粘贴授权码", text: $model.licenseInput)
                        .textFieldStyle(.roundedBorder)
                    Button {
                        if let code = NSPasteboard.general.string(forType: .string) {
                            model.licenseInput = code.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                    } label: {
                        Label("粘贴", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(.bordered)
                }
                .disabled(model.entitlement?.activationConfigured != true || model.isBusy)

                if model.redemptionSkinSelectionRequired {
                    VStack(alignment: .leading, spacing: 7) {
                        Label("这是单套皮肤授权码", systemImage: "paintpalette.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                        Text("请到皮肤页，在想要永久拥有的那套皮肤卡片上点击“解锁”。授权码会在最终确认后只绑定当前皮肤，不再从全量列表二次选择。")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("前往皮肤页") { showCatalogSkins() }
                            .controlSize(.small)
                    }
                    .padding(9)
                    .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
                } else {
                    Text("如果这是单套皮肤码，可信服务会先要求你选择皮肤；首次请求不会携带 skinId。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Button {
                    Task { await model.activateLicense() }
                } label: {
                    Label("验证并同步权益", systemImage: "checkmark.seal.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    model.licenseInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || model.entitlement?.activationConfigured != true
                    || model.isBusy
                )
            }
            .studioCard()

            if model.entitlement?.activationConfigured != true {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "info.circle.fill")
                        .foregroundStyle(.orange)
                    Text(LingGlowL10n.string(model.productCatalog?.commerce.unavailableReason ?? "Dodo 公共 License API 当前不可用；购买与兑换不会伪装成功。"))
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .studioCard()
            }

            // A local first-use trial intentionally has no license cache to
            // clear. Keeping this control paid-license-only makes it obvious
            // that deleting an authorization code cannot reset seven days.
            if model.entitlement?.license != nil {
                HStack {
                    if model.entitlement?.refreshConfigured == true {
                        Button {
                            Task { await model.refreshLicense() }
                        } label: {
                            Label("刷新权益", systemImage: "arrow.triangle.2.circlepath")
                        }
                    }
                    Spacer()
                    if model.entitlement?.deactivationConfigured == true {
                        Button(role: .destructive) {
                            guard presentLicenseDeactivationConfirmation() else { return }
                            Task { await model.deactivateLicense() }
                        } label: {
                            Label("停用此设备", systemImage: "rectangle.badge.xmark")
                        }
                    } else {
                        Button(role: .destructive) {
                            guard presentLicenseRemovalConfirmation() else { return }
                            Task { await model.removeLicense() }
                        } label: {
                            Label("仅清除本机缓存", systemImage: "trash")
                        }
                    }
                }
                .disabled(model.isBusy)
            }
        }
        .sheet(isPresented: $showingAgreementPrompt) {
            PurchaseConsentSheet(
                productName: pendingProductName,
                accepted: $acceptedPurchaseTerms,
                cancel: {
                    pendingCheckoutURL = nil
                    pendingProductName = ""
                    showingAgreementPrompt = false
                },
                confirm: {
                    if let url = pendingCheckoutURL {
                        NSWorkspace.shared.open(url)
                    }
                    pendingCheckoutURL = nil
                    pendingProductName = ""
                    showingAgreementPrompt = false
                }
            )
        }
        .task {
            await model.loadProductCatalogIfNeeded()
        }
    }

    private var entitlementCard: some View {
        let paidSkins = model.entitlement?.purchasedSkinIds.count ?? 0
        let customSlots = model.entitlement?.unlockedCustomProfileIds.count ?? 0
        let hasPermanentEntitlement = paidSkins > 0 || customSlots > 0
        let trial = model.entitlement?.trial
        let localTrialActive = model.entitlement?.source == "local-trial" && trial?.isActive == true
        let localTrialExpired = model.entitlement?.source != "license" && trial?.isExpired == true
        let accent: Color = localTrialActive ? .pink : (model.isVIP ? .orange : (hasPermanentEntitlement ? .indigo : .secondary))
        let permanentTitle: String
        if paidSkins > 0 && customSlots > 0 {
            permanentTitle = LingGlowL10n.string("%lld 套永久皮肤 · %lld 个永久自定义位", paidSkins, customSlots)
        } else if paidSkins > 0 {
            permanentTitle = LingGlowL10n.string("%lld 套永久皮肤已激活", paidSkins)
        } else {
            permanentTitle = LingGlowL10n.string("%lld 个永久自定义位已激活", customSlots)
        }
        let title = LingGlowL10n.string(localTrialActive
            ? "7 天免费 VIP 试用中"
            : (model.isVIP ? "VIP 已激活" : (hasPermanentEntitlement ? permanentTitle : "免费版")))
        let badge = localTrialActive ? "TRIAL" : (model.isVIP ? "VIP" : (hasPermanentEntitlement ? "OWNED" : "FREE"))
        return HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(accent.opacity(0.15))
                Text(localTrialActive ? "7" : (model.isVIP ? "V" : (hasPermanentEntitlement ? "购" : "免")))
                    .font(.title2.bold())
                    .foregroundStyle(accent)
            }
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                if localTrialActive, let trial {
                    Text("本机首次使用免费 VIP · 剩余 \(trial.remainingDisplay) · 到期 \(trial.expiryDisplay)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("这是本机试用，不是 Dodo 订阅或授权码；移除本机授权缓存不会重置试用。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let license = model.entitlement?.license {
                    Text("授权 \(license.licenseId) · 单套皮肤 \(paidSkins) · 自定义位 \(customSlots)\(license.expiresAt.map { " · 租约至 \($0.prefix(10))" } ?? "")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    if paidSkins > 0 {
                        Text("永久皮肤：\((model.entitlement?.purchasedSkinIds.sorted() ?? []).joined(separator: "、"))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .textSelection(.enabled)
                    }
                    if customSlots > 0 {
                        Text("永久自定义位：\(model.customProfileSlotIds.joined(separator: "、"))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .textSelection(.enabled)
                    }
                } else if localTrialExpired, let trial {
                    Text("7 天免费 VIP 试用已于 \(trial.expiryDisplay) 结束；免费皮肤仍可使用。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("免费皮肤可用 · 尚无已同步付费权益")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            StatusPill(text: badge, color: model.isVIP ? .orange : (hasPermanentEntitlement ? .indigo : .green))
        }
        .studioCard()
    }
}

private struct PurchaseConsentSheet: View {
    let productName: String
    @Binding var accepted: Bool
    let cancel: () -> Void
    let confirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 13) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 25, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(
                        LinearGradient(
                            colors: [LingGlowPalette.berry, LingGlowPalette.coral],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text(LingGlowL10n.string("确认购买协议"))
                        .font(.title3.bold())
                    Text(LingGlowL10n.string(productName))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Text(LingGlowL10n.string("灵妆提供即时交付的数字授权与虚拟服务。除适用法律或 Dodo Payments 规则另有规定外，购买后不支持退货退款。"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Toggle(isOn: $accepted) {
                Text(LingGlowL10n.string("我已阅读并同意《购买说明》和《隐私政策》"))
            }
            .font(.subheadline.weight(.semibold))
            .toggleStyle(.checkbox)

            HStack(spacing: 8) {
                Button(action: { NSWorkspace.shared.open(LingGlowLegalLinks.purchaseTerms) }) {
                    Text(LingGlowL10n.string("购买说明"))
                }
                Button(action: { NSWorkspace.shared.open(LingGlowLegalLinks.privacy) }) {
                    Text(LingGlowL10n.string("隐私政策"))
                }
                Spacer()
            }
            .buttonStyle(.link)
            .font(.caption)

            HStack(spacing: 10) {
                Spacer()
                Button(action: cancel) {
                    Text(LingGlowL10n.string("取消"))
                }
                    .keyboardShortcut(.cancelAction)
                Button(action: confirm) {
                    Text(LingGlowL10n.string("确认并前往购买"))
                }
                    .buttonStyle(.borderedProminent)
                    .tint(LingGlowPalette.berry)
                    .disabled(!accepted)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 470)
        .background(LingGlowBackdrop())
    }
}

private struct DodoProductCard: View {
    let product: ProductCatalogItem
    let unavailableReason: String?
    let purchase: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 28, height: 28)
                .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(LingGlowL10n.string(product.name))
                        .font(.subheadline.weight(.semibold))
                    Spacer(minLength: 8)
                    Text(LingGlowL10n.string(term))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(color)
                }
                Text(LingGlowL10n.string(product.summary))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(product.features, id: \.self) { feature in
                        Label(LingGlowL10n.string(feature), systemImage: "checkmark")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(LingGlowL10n.string(binding))
                    .font(.caption2)
                    .foregroundStyle(color)
                    .fixedSize(horizontal: false, vertical: true)
                if let reason = unavailableReason {
                    Label(LingGlowL10n.string(reason), systemImage: "exclamationmark.lock.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(LingGlowL10n.string(product.billing.kind == "subscription" ? "前往订阅" : "前往购买"), action: purchase)
                    .controlSize(.small)
                    .disabled(unavailableReason != nil)
            }
        }
        .padding(10)
        .background(color.opacity(0.055), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(color.opacity(0.14)))
    }

    private var color: Color {
        switch product.offerType {
        case "vip_subscription": return .orange
        case "skin_once": return .pink
        case "custom_slot_once": return .indigo
        default: return .blue
        }
    }

    private var symbol: String {
        switch product.offerType {
        case "vip_subscription": return "crown.fill"
        case "skin_once": return "paintpalette.fill"
        case "custom_slot_once": return "slider.horizontal.3"
        default: return "shippingbox.fill"
        }
    }

    private var term: String {
        if product.billing.kind == "subscription" {
            return LingGlowL10n.string(product.billing.interval == "year" ? "按年订阅" : "按月订阅")
        }
        return LingGlowL10n.string("永久有效")
    }

    private var binding: String {
        guard product.binding.immutable else { return LingGlowL10n.string("不绑定单套资源") }
        switch product.binding.kind {
        case "skin": return LingGlowL10n.string("授权码首次兑换选择后永久绑定该皮肤，不可换绑。")
        case "profile": return LingGlowL10n.string("首次兑换后永久绑定一个自定义位，不可换绑。")
        default: return LingGlowL10n.string("授权关系由 Dodo License 与本机加密授权库共同保存。")
        }
    }
}

private struct SettingsView: View {
    @ObservedObject var model: StudioModel
    @State private var automaticUpdatesEnabled = LingGlowUpdateManager.shared.automaticUpdatesEnabled
    @State private var checkingUpdate = false
    @State private var installingUpdate = false
    @State private var availableUpdate: LingGlowUpdateManifest?
    @State private var updateMessage = LingGlowL10n.string("自动检查已开启，只安装通过签名与公证校验的版本。")
    @State private var skillMessage: String?
    private let updateManager = LingGlowUpdateManager.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .top, spacing: 16) {
                updateCard
                    .frame(maxWidth: .infinity)
                skillCard
                    .frame(maxWidth: .infinity)
            }

            VStack(spacing: 0) {
                languageCard
                Divider().padding(.horizontal, 16)
                loginAgentCard
                Divider().padding(.horizontal, 16)
                diagnosticsCard
                Divider().padding(.horizontal, 16)
                legalCard
                Divider().padding(.horizontal, 16)
                securityCard
            }
            .background(LingGlowPalette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.primary.opacity(0.07)))

            HStack {
                Button {
                    Task { await model.refreshDoctor() }
                } label: {
                    Label("重新安全检测", systemImage: "arrow.clockwise")
                }
                .disabled(model.isBusy)

                Spacer()

                Button("退出灵妆") {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
    }

    private var languageCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "character.bubble.fill")
                .font(.title3)
                .foregroundStyle(LingGlowPalette.berry)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text("界面语言")
                    .font(.headline)
                Text("仅支持中文和 English，切换后立即生效。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Picker("界面语言", selection: Binding(
                get: { model.interfaceLanguage },
                set: { model.setInterfaceLanguage($0) }
            )) {
                Text("中文").tag("zh-Hans")
                Text("English").tag("en")
            }
            .labelsHidden()
            .frame(width: 160)
            .onChange(of: model.interfaceLanguage) { value in
                updateMessage = LingGlowL10n.string("界面语言已立即更新。")
            }
        }
        .padding(16)
    }

    private var updateCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("应用更新", systemImage: "sparkles.rectangle.stack.fill")
                    .font(.headline)
                Spacer()
                StatusPill(text: "v\(updateManager.currentVersion)", color: LingGlowPalette.cyan)
            }
            Toggle("启动时自动检查并安装安全更新", isOn: $automaticUpdatesEnabled)
                .toggleStyle(.switch)
                .tint(LingGlowPalette.coral)
                .onChange(of: automaticUpdatesEnabled) { value in
                    updateManager.automaticUpdatesEnabled = value
                    updateMessage = LingGlowL10n.string(value ? "自动更新已开启。" : "自动更新已关闭，可随时手动检查。")
                }
            Text(LingGlowL10n.string(updateMessage))
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Button {
                    checkForUpdate()
                } label: {
                    Label(LingGlowL10n.string(checkingUpdate ? "正在检查" : "立即检查"), systemImage: "arrow.clockwise")
                }
                .disabled(checkingUpdate || installingUpdate)

                if let update = availableUpdate {
                    Button {
                        install(update)
                    } label: {
                        Label(installingUpdate
                              ? LingGlowL10n.string("正在安装")
                              : LingGlowL10n.string("安装 v%@", update.version),
                              systemImage: "arrow.down.app.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(LingGlowPalette.coral)
                    .disabled(installingUpdate)
                }
                if checkingUpdate || installingUpdate {
                    ProgressView().controlSize(.small)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: LingGlowLayout.featureHeight, alignment: .topLeading)
        .studioCard(padding: 16)
    }

    private var skillCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("制作自己的皮肤", systemImage: "wand.and.stars")
                    .font(.headline)
                Spacer()
                StatusPill(text: "免费", color: .green)
            }
            Text("安装灵妆皮肤制作 SKILL 后，可在 Codex 中按统一尺寸、深浅模式和三端适配规则生成模板。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button {
                    installSkinSkill()
                } label: {
                    Label("一键安装 SKILL", systemImage: "square.and.arrow.down.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(LingGlowPalette.cyan)
                Button("查看制作手册") {
                    NSWorkspace.shared.open(LingGlowLegalLinks.skinGuide)
                }
            }
            if let skillMessage {
                Text(LingGlowL10n.string(skillMessage))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: LingGlowLayout.featureHeight, alignment: .topLeading)
        .studioCard(padding: 16)
    }

    private var securityCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("安全边界", systemImage: "lock.shield.fill")
                .font(.headline)
            SecurityRow(text: "只连接本机 127.0.0.1，并使用私有会话令牌")
            SecurityRow(text: "打开菜单栏不会启动 WorkBuddy、豆包或 Codex")
            SecurityRow(text: "不接受任意 JavaScript、远程素材或 TCP 调试回退")
            SecurityRow(text: "只有一次性意图经过原生确认后才会重启目标应用")
        }
        .padding(16)
    }

    private func checkForUpdate() {
        checkingUpdate = true
        updateMessage = LingGlowL10n.string("正在读取安全更新清单…")
        Task {
            do {
                let update = try await updateManager.availableUpdate()
                await MainActor.run {
                    availableUpdate = update
                    updateMessage = update == nil
                        ? LingGlowL10n.string("当前已是最新版本。")
                        : LingGlowL10n.string("发现 v%@，可立即下载并安全安装。", update!.version)
                    checkingUpdate = false
                }
            } catch {
                await MainActor.run {
                    updateMessage = LingGlowL10n.string("检查失败：%@", error.localizedDescription)
                    checkingUpdate = false
                }
            }
        }
    }

    private func install(_ update: LingGlowUpdateManifest) {
        installingUpdate = true
        updateMessage = LingGlowL10n.string("正在下载并验证签名、公证与校验和…")
        Task {
            do {
                try await updateManager.downloadVerifyAndInstall(update)
                await MainActor.run {
                    updateMessage = LingGlowL10n.string("安装程序已启动，灵妆将自动完成替换。")
                    installingUpdate = false
                }
            } catch {
                await MainActor.run {
                    updateMessage = LingGlowL10n.string("安装失败：%@", error.localizedDescription)
                    installingUpdate = false
                }
            }
        }
    }

    private func installSkinSkill() {
        skillMessage = LingGlowL10n.string("正在下载并安装…")
        Task {
            do {
                let (archive, _) = try await URLSession.shared.download(from: LingGlowLegalLinks.skillArchive)
                let fileManager = FileManager.default
                let destination = fileManager.homeDirectoryForCurrentUser
                    .appendingPathComponent(".codex/skills/lingglow-skin-maker", isDirectory: true)
                let staging = fileManager.temporaryDirectory
                    .appendingPathComponent("LingGlow-Skin-Skill-\(UUID().uuidString)", isDirectory: true)
                try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
                defer { try? fileManager.removeItem(at: staging) }
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                process.arguments = ["-x", "-k", archive.path, staging.path]
                try process.run()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                let candidates = try fileManager.contentsOfDirectory(at: staging, includingPropertiesForKeys: nil)
                let source = candidates.first(where: { $0.hasDirectoryPath }) ?? staging
                try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                // Stage the new SKILL next to the installed one and swap it in
                // atomically: a failed copy must never leave the user without
                // the SKILL they already had.
                let incoming = destination.deletingLastPathComponent()
                    .appendingPathComponent(".lingglow-skin-maker-\(UUID().uuidString)", isDirectory: true)
                defer { try? fileManager.removeItem(at: incoming) }
                try fileManager.copyItem(at: source, to: incoming)
                if fileManager.fileExists(atPath: destination.path) {
                    _ = try fileManager.replaceItemAt(destination, withItemAt: incoming)
                } else {
                    try fileManager.moveItem(at: incoming, to: destination)
                }
                await MainActor.run {
                    skillMessage = LingGlowL10n.string("已安装到 ~/.codex/skills/lingglow-skin-maker，重新打开 Codex 后即可使用。")
                }
            } catch {
                await MainActor.run {
                    skillMessage = LingGlowL10n.string("安装失败：%@。可打开制作手册手动安装。", error.localizedDescription)
                }
            }
        }
    }

    private var legalCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("隐私与购买", systemImage: "doc.text.fill")
                .font(.headline)
            Text("支付由 Dodo Payments 作为 Merchant of Record 处理；灵妆不保存银行卡信息。数字授权除适用法律或 Dodo 规则另有规定外不支持退货退款。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("隐私政策") { NSWorkspace.shared.open(LingGlowLegalLinks.privacy) }
                Button("购买说明") { NSWorkspace.shared.open(LingGlowLegalLinks.purchaseTerms) }
                Button("Dodo 隐私政策") { NSWorkspace.shared.open(LingGlowLegalLinks.dodoPrivacy) }
            }
            .controlSize(.small)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(16)
    }

    private var loginAgentCard: some View {
        let agent = model.status?.loginAgent
        let conflict = agent?.installed == true && agent?.managed != true
        let unavailable = agent?.state == "unsafe" || agent?.state == "unavailable"
        return VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("随登录启动排程提醒", systemImage: "bell.badge.fill")
                    .font(.headline)
                Spacer()
                StatusPill(
                    text: agent?.managed == true ? "已开启" : conflict ? "需要检查" : "已关闭",
                    color: agent?.managed == true ? .green : conflict ? .red : .secondary
                )
            }
            Text(loginAgentDescription(agent))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(LingGlowL10n.string(agent?.managed == true ? "关闭登录提醒" : "开启登录提醒（VIP）")) {
                Task { await model.toggleLoginAgent() }
            }
            .disabled(model.isBusy || conflict || unavailable || (agent?.managed != true && !model.isVIP))
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(16)
    }

    private var diagnosticsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("本机状态", systemImage: "checkmark.shield.fill")
                    .font(.headline)
                Spacer()
                Text("服务 \(model.status?.studio.version ?? "—")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Divider()
            ForEach(ClientID.allCases) { client in
                let value = model.status?.clients[client.rawValue]
                HStack {
                    Text(client.displayName)
                        .font(.subheadline.weight(.medium))
                        .frame(width: 82, alignment: .leading)
                    Text(value?.installed == true
                         ? "\(value?.version ?? "未知版本") · \(value?.compatibility.displayLevel ?? "检测中")"
                         : "未安装")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: value?.signatureValid == true && value?.trustedPublisher == true
                          ? "checkmark.seal.fill"
                          : "minus.circle")
                        .foregroundStyle(value?.signatureValid == true && value?.trustedPublisher == true
                                         ? Color.green : Color.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(16)
    }

    private func loginAgentDescription(_ value: LoginAgentStatus?) -> String {
        guard let value else { return LingGlowL10n.string("正在读取登录项状态…") }
        if value.managed {
            return LingGlowL10n.string("下次登录后会在后台检查当天排程；每次换肤仍先询问，不会静默重启。")
        }
        if value.installed {
            return LingGlowL10n.string("检测到非灵妆管理的同名登录项。为避免覆盖未知配置，本应用不会修改它。")
        }
        if value.state == "unsafe" || value.state == "unavailable" {
            return LingGlowL10n.string("登录项目录或启动脚本未通过安全检查，因此没有进行任何修改。")
        }
        return LingGlowL10n.string("默认关闭。开启后只启动同目录的本地后台，不会自动打开目标应用。")
    }
}

private struct SecurityRow: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: "checkmark")
                .font(.caption.bold())
                .foregroundStyle(.green)
                .padding(.top, 1)
            Text(LingGlowL10n.string(text))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(LingGlowL10n.string(text))
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(color.opacity(0.11), in: Capsule())
    }
}

private extension View {
    func studioCard(padding: CGFloat = 12) -> some View {
        modifier(StudioCardModifier(padding: padding))
    }
}

private enum LingGlowPalette {
    static let berry = Color(red: 0.73, green: 0.29, blue: 0.35)
    static let sidebar = Color.white.opacity(0.42)
    static let accent = Color(red: 0.886, green: 0.333, blue: 0.388)
    static let accentSoft = Color(red: 0.98, green: 0.87, blue: 0.89)
    static let coral = accent
    static let gold = Color(red: 0.91, green: 0.64, blue: 0.56)
    static let cyan = accent
    static let ink = Color(red: 0.169, green: 0.133, blue: 0.141)
    static let text = ink
    static let pearl = Color(red: 0.98, green: 0.96, blue: 0.965)
    static let canvas = Color(red: 0.969, green: 0.957, blue: 0.961)
    static let mist = accentSoft
    static let surface = Color(red: 0.969, green: 0.957, blue: 0.961)
}

private enum LingGlowLayout {
    static let contentWidth: CGFloat = 1160
    static let pageInset: CGFloat = 28
    static let cardPadding: CGFloat = 14
    static let compactCardPadding: CGFloat = 10
    static let sectionSpacing: CGFloat = 12
    static let compactSummaryHeight: CGFloat = 68
    static let summaryHeight: CGFloat = 104
    static let featureHeight: CGFloat = 128
    static let skinPreviewHeight: CGFloat = 180
    static let skinCardHeight: CGFloat = 308
}

private struct LingGlowBackdrop: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            LingGlowPalette.canvas
            if let url = Bundle.main.url(forResource: "LingGlowShellBackground", withExtension: "webp"),
               let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            }
            LinearGradient(
                colors: [Color.white.opacity(0.08), LingGlowPalette.canvas.opacity(0.20)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .ignoresSafeArea()
        .clipped()
    }
}

private struct LingGlowSidebarBackground: View {
    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            LingGlowPalette.sidebar
        }
    }
}

private struct LingGlowPanelBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Color.white.opacity(0.34)
        }
    }
}

private struct StudioCardModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LingGlowPalette.surface.opacity(0.88), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(LingGlowPalette.berry.opacity(0.10))
            )
    }
}

private extension Color {
    init(hex: String) {
        let normalized = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        guard normalized.count == 6, Scanner(string: normalized).scanHexInt64(&value) else {
            self = .gray
            return
        }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }
}

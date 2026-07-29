import AppKit
import SwiftUI

/// A local-only representation of a full `UnionProfile`.
///
/// This file deliberately has no networking, CDP, launch, or apply path.  It
/// resolves values by schema field ID (rather than by the legacy v1 profile
/// shape), so the same preview can render an executable profile, a future
/// unknown-field-preserving profile, or a Doubao design-only draft.
///
/// Typical insertion point in a SwiftUI editor:
///
/// ```swift
/// AgentSkinPreview(
///     profile: draft,
///     schema: schema,
///     client: selectedClient,
///     freeBrand: model.freeBrand
/// )
/// ```
enum UnionProfilePreviewDensity {
    case compact
    case regular

    fileprivate var canvasHeight: CGFloat {
        switch self {
        case .compact: return 190
        case .regular: return 258
        }
    }

    fileprivate var padding: CGFloat {
        switch self {
        case .compact: return 9
        case .regular: return 13
        }
    }
}

/// A reusable, non-interactive skin preview for the native menu-bar app.
///
/// It intentionally communicates preview truth: WorkBuddy is represented as
/// an exact visual target, Codex labels candidate chrome as local-only, and
/// Doubao is always rendered as a non-executable design board.
struct AgentSkinPreview: View {
    let profile: UnionProfile
    let schema: CapabilitySchemaResponse
    let client: ClientID
    let freeBrand: WorkBuddyFreeBrand?
    let density: UnionProfilePreviewDensity

    init(
        profile: UnionProfile,
        schema: CapabilitySchemaResponse,
        client: ClientID,
        freeBrand: WorkBuddyFreeBrand? = nil,
        density: UnionProfilePreviewDensity = .regular
    ) {
        self.profile = profile
        self.schema = schema
        self.client = client
        self.freeBrand = freeBrand
        self.density = density
    }

    var body: some View {
        let resolver = UnionProfilePreviewResolver(
            profile: profile,
            schema: schema,
            client: client,
            freeBrand: freeBrand
        )

        VStack(alignment: .leading, spacing: 8) {
            header(resolver)

            Group {
                switch client {
                case .workbuddy:
                    WorkBuddyUnionPreview(resolver: resolver, density: density)
                case .codex:
                    CodexUnionPreview(resolver: resolver, density: density)
                case .doubao:
                    DoubaoDesignUnionPreview(resolver: resolver, density: density)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(resolver.accessibilitySummary)
        }
    }

    private func header(_ resolver: UnionProfilePreviewResolver) -> some View {
        HStack(spacing: 7) {
            Image(systemName: resolver.headerSymbol)
                .foregroundStyle(resolver.palette.accent)
            Text(LingGlowL10n.string(resolver.headerTitle))
                .font(resolver.uiFont(size: 11, weight: .semibold))
                .lineLimit(1)
            Text(LingGlowL10n.string(resolver.foundationSummary))
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(LingGlowL10n.string(resolver.truthLabel))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(resolver.truthColor)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(resolver.truthColor.opacity(0.12), in: Capsule())
        }
    }
}

/// Resolves `UnionProfile.values` by field ID first, followed by the schema's
/// complete-union defaults. A tiny fallback table only keeps previews useful
/// against an older local host that has not yet returned `fields`.
struct UnionProfilePreviewResolver {
    let profile: UnionProfile
    let schema: CapabilitySchemaResponse
    let client: ClientID
    let freeBrand: WorkBuddyFreeBrand?

    private let schemaDefaults: [String: JSONValue]

    init(
        profile: UnionProfile,
        schema: CapabilitySchemaResponse,
        client: ClientID,
        freeBrand: WorkBuddyFreeBrand? = nil
    ) {
        self.profile = profile
        self.schema = schema
        self.client = client
        self.freeBrand = freeBrand

        var defaults = Self.minimumPreviewDefaults
        for field in schema.fields ?? [] {
            defaults[field.id] = field.defaultValue
        }
        // Older backends might omit the full union list. The projection still
        // has safe defaults for fields exposed by its selected Agent.
        for field in schema.editorProjection.fields where defaults[field.id] == nil {
            defaults[field.id] = field.defaultValue
        }
        self.schemaDefaults = defaults
    }

    /// The canonical value lookup used by every preview element.
    func value(for fieldID: String) -> JSONValue? {
        profile.values[fieldID] ?? schemaDefaults[fieldID]
    }

    func string(_ fieldID: String, fallback: String = "") -> String {
        value(for: fieldID)?.stringValue ?? fallback
    }

    func optionalString(_ fieldID: String) -> String? {
        guard let value = value(for: fieldID)?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    func bool(_ fieldID: String, fallback: Bool) -> Bool {
        value(for: fieldID)?.boolValue ?? fallback
    }

    func number(_ fieldID: String, fallback: Double, range: ClosedRange<Double>? = nil) -> Double {
        let raw = value(for: fieldID)?.numberValue ?? fallback
        guard raw.isFinite else { return fallback }
        guard let range else { return raw }
        return min(max(raw, range.lowerBound), range.upperBound)
    }

    func image(for fieldID: String) -> NSImage? {
        // `LocalImageAsset` accepts only local image data URLs. It neither
        // requests a remote URL nor opens an external application.
        LocalImageAsset.previewImage(from: optionalString(fieldID))
    }

    func imageFills(_ fitFieldID: String) -> Bool {
        string(fitFieldID, fallback: "cover") != "contain"
    }

    func supportStatus(for fieldID: String) -> String? {
        schema.editorProjection.fields.first(where: { $0.id == fieldID })?.supportStatus
    }

    var palette: UnionProfilePreviewPalette {
        UnionProfilePreviewPalette(
            accent: UnionProfilePreviewColor.make(string("appearance.accent", fallback: "#7AA2F7"), fallback: .blue),
            surface: UnionProfilePreviewColor.make(string("appearance.surface", fallback: "#111827"), fallback: .gray),
            ink: UnionProfilePreviewColor.make(string("appearance.ink", fallback: "#E5E7EB"), fallback: .white),
            diffAdded: UnionProfilePreviewColor.make(string("semantic.diffAdded", fallback: "#22C55E"), fallback: .green),
            diffRemoved: UnionProfilePreviewColor.make(string("semantic.diffRemoved", fallback: "#EF4444"), fallback: .red),
            skill: UnionProfilePreviewColor.make(string("semantic.skill", fallback: "#A78BFA"), fallback: .purple)
        )
    }

    var panelColor: Color {
        guard bool("glass.enabled", fallback: true) else { return palette.surface }
        return palette.surface.opacity(number("glass.opacity", fallback: 0.74, range: 0.35...0.98))
    }

    var radius: CGFloat {
        CGFloat(number("shape.radius", fallback: 16, range: 8...28))
    }

    var sidebarPreviewWidth: CGFloat {
        // The source value remains the true schema field; this scales it into
        // the small local canvas instead of treating it as a screen width.
        let actual = number("layout.sidebarWidth", fallback: 275, range: 240...420)
        return CGFloat(min(max(actual * 0.39, 86), 148))
    }

    var backgroundImage: NSImage? { image(for: "background.image") }
    var backgroundOpacity: Double { number("background.opacity", fallback: 0.55, range: 0.05...1) }
    var backgroundOverlay: Double { number("background.overlay", fallback: 0.58, range: 0...0.95) }
    var backgroundBlur: CGFloat { CGFloat(number("background.blur", fallback: 0, range: 0...24)) }
    var backgroundAlignment: Alignment { alignment(for: "background.position") }
    var advancedEnabled: Bool { bool("advanced.enabled", fallback: false) }
    var appearanceVariant: String { string("appearance.variant", fallback: "dark") }
    var contrast: Double { number("appearance.contrast", fallback: 45, range: 0...100) }
    var windowOpaque: Bool { bool("window.opaque", fallback: true) }
    var glassBlur: Double { number("glass.blur", fallback: 18, range: 0...32) }
    var motionPreset: String { string("motion.preset", fallback: "subtle") }
    var panelBorderOpacity: Double { 0.07 + (contrast / 100 * 0.12) }
    var codexBannerPreviewHeight: CGFloat {
        let sourceHeight = number("codex.banner.height", fallback: 112, range: 48...240)
        return CGFloat(min(max(sourceHeight * 0.40, 33), 58))
    }
    var codexBannerMetadata: String {
        let position = string("codex.banner.position", fallback: "top-center")
        let width = Int(number("codex.banner.width", fallback: 720, range: 240...1200))
        let height = Int(number("codex.banner.height", fallback: 112, range: 48...240))
        return "\(position) · \(width)×\(height)"
    }

    var foundationSummary: String {
        let variant = LingGlowL10n.string(appearanceVariant == "light" ? "浅色" : "深色")
        let advanced = LingGlowL10n.string(advancedEnabled ? "高级层" : "高级层关闭")
        return LingGlowL10n.string("%@ · %@ · 对比度 %lld", advanced, variant, Int(contrast))
    }

    func uiFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if let fontName = optionalString("typography.uiFont"), fontName.count <= 80 {
            return .custom(fontName, size: size)
        }
        return .system(size: size, weight: weight)
    }

    func codeFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if let fontName = optionalString("typography.codeFont"), fontName.count <= 80 {
            return .custom(fontName, size: size)
        }
        return .system(size: size, weight: weight, design: .monospaced)
    }

    func alignment(for positionFieldID: String) -> Alignment {
        switch string(positionFieldID, fallback: "center").lowercased() {
        case "top left", "top-left": return .topLeading
        case "top", "top center", "top-center": return .top
        case "top right", "top-right": return .topTrailing
        case "left": return .leading
        case "right": return .trailing
        case "bottom left", "bottom-left": return .bottomLeading
        case "bottom", "bottom center", "bottom-center": return .bottom
        case "bottom right", "bottom-right": return .bottomTrailing
        default: return .center
        }
    }

    var effectiveBrand: UnionProfilePreviewBrand {
        let profileBrandEnabled = bool("brand.enabled", fallback: false)
        let profileName = optionalString("brand.displayName")
        let profileIcon = optionalString("brand.iconImage")
        let profileMark = optionalString("brand.shortMark")
        let freeName = client == .workbuddy
            ? freeBrand?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
            : nil
        let freeIcon = client == .workbuddy ? freeBrand?.iconImage : nil
        let hasFreeOverride = (freeName?.isEmpty == false) || (freeIcon?.isEmpty == false)

        let defaultName: String
        let defaultMark: String
        switch client {
        case .workbuddy:
            defaultName = "WorkBuddy"
            defaultMark = "WB"
        case .codex:
            defaultName = "Codex"
            defaultMark = "C"
        case .doubao:
            defaultName = LingGlowL10n.string("豆包")
            defaultMark = "D"
        }

        let enabled = profileBrandEnabled || hasFreeOverride
        let name: String
        let iconDataURL: String?
        if hasFreeOverride {
            // Match the runtime merge rule: the free WorkBuddy brand wins for
            // the attributes it provides but leaves the skin's other brand
            // attributes intact.
            name = (freeName?.isEmpty == false ? freeName! : (profileName ?? defaultName))
            iconDataURL = (freeIcon?.isEmpty == false ? freeIcon : profileIcon)
        } else if profileBrandEnabled {
            name = profileName ?? defaultName
            iconDataURL = profileIcon
        } else {
            name = defaultName
            iconDataURL = nil
        }

        let suppliedMark = profileMark?.prefix(3)
        let derivedMark = String(name.prefix(2)).uppercased()
        let mark = suppliedMark.map(String.init) ?? (derivedMark.isEmpty ? defaultMark : derivedMark)
        let style = string("brand.logoStyle", fallback: "original")
        return UnionProfilePreviewBrand(
            enabled: enabled,
            displayName: name,
            shortMark: mark,
            iconImage: iconDataURL.flatMap { LocalImageAsset.previewImage(from: $0) },
            style: style
        )
    }

    var headerTitle: String {
        let display = profile.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return display.isEmpty ? LingGlowL10n.string("%@ 本地皮肤预览", client.displayName) : display
    }

    var headerSymbol: String {
        switch client {
        case .workbuddy: return "rectangle.3.group.bubble.left"
        case .codex: return "chevron.left.forwardslash.chevron.right"
        case .doubao: return "paintpalette"
        }
    }

    var truthLabel: String {
        switch client {
        case .workbuddy:
            return LingGlowL10n.string("本地视觉映射")
        case .codex:
            return LingGlowL10n.string("候选仅预览")
        case .doubao:
            return LingGlowL10n.string("仅设计草图")
        }
    }

    var truthColor: Color {
        switch client {
        case .workbuddy: return .green
        case .codex: return .orange
        case .doubao: return .orange
        }
    }

    var accessibilitySummary: String {
        switch client {
        case .workbuddy:
            return LingGlowL10n.string("WorkBuddy 本地皮肤预览，包含品牌、标签页、项目 Hero、发送与停止控件。")
        case .codex:
            return LingGlowL10n.string("Codex 本地皮肤预览，包含侧栏、编辑器和候选横幅；候选界面字段尚未注入。")
        case .doubao:
            return LingGlowL10n.string("豆包本地设计草图，包含首页 Hero、头像和卡片；未启动、未连接、未注入豆包。")
        }
    }

    private static let minimumPreviewDefaults: [String: JSONValue] = [
        "appearance.accent": .string("#7AA2F7"),
        "appearance.surface": .string("#111827"),
        "appearance.ink": .string("#E5E7EB"),
        "semantic.diffAdded": .string("#22C55E"),
        "semantic.diffRemoved": .string("#EF4444"),
        "semantic.skill": .string("#A78BFA"),
        "background.opacity": .number(0.55),
        "background.overlay": .number(0.58),
        "background.blur": .number(0),
        "glass.enabled": .bool(true),
        "glass.opacity": .number(0.74),
        "shape.radius": .number(16),
        "layout.sidebarWidth": .number(275),
        "brand.enabled": .bool(false),
        "brand.logoStyle": .string("original"),
        "codex.banner.enabled": .bool(false),
        "codex.banner.opacity": .number(0.45),
        "codex.banner.height": .number(112),
        "codex.banner.width": .number(720),
        "codex.banner.position": .string("top-center"),
        "codex.codeThemeId": .string("codex"),
        "workbuddy.projectHero.fit": .string("cover"),
        "doubao.homeHero.fit": .string("cover"),
        "doubao.assistantAvatar.fit": .string("cover"),
        "doubao.assistantAvatar.shape": .string("circle"),
    ]
}

struct UnionProfilePreviewPalette {
    let accent: Color
    let surface: Color
    let ink: Color
    let diffAdded: Color
    let diffRemoved: Color
    let skill: Color
}

struct UnionProfilePreviewBrand {
    let enabled: Bool
    let displayName: String
    let shortMark: String
    let iconImage: NSImage?
    let style: String
}

private struct WorkBuddyUnionPreview: View {
    let resolver: UnionProfilePreviewResolver
    let density: UnionProfilePreviewDensity

    var body: some View {
        UnionProfilePreviewFrame(resolver: resolver, density: density) {
            HStack(spacing: 0) {
                sidebar
                Rectangle().fill(resolver.palette.ink.opacity(0.10)).frame(width: 1)
                mainArea
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: density == .compact ? 6 : 9) {
            HStack(spacing: 6) {
                UnionProfilePreviewBrandMark(brand: resolver.effectiveBrand, palette: resolver.palette)
                    .frame(width: density == .compact ? 20 : 25, height: density == .compact ? 20 : 25)
                Text(LingGlowL10n.string(resolver.effectiveBrand.displayName))
                    .font(resolver.uiFont(size: density == .compact ? 8 : 10, weight: .semibold))
                    .lineLimit(1)
                    .foregroundStyle(resolver.palette.ink)
            }

            VStack(alignment: .leading, spacing: 3) {
                WorkBuddyPreviewTab(title: "新建任务", symbol: "plus", selected: false, resolver: resolver)
                WorkBuddyPreviewTab(title: "项目", symbol: "square.grid.2x2", selected: true, resolver: resolver)
                WorkBuddyPreviewTab(title: "历史", symbol: "clock", selected: false, resolver: resolver)
            }

            Spacer(minLength: 2)
            Label(
                "静态预览 · \(resolver.motionPreset) · 玻璃 \(Int(resolver.glassBlur))",
                systemImage: "checkmark.circle.fill"
            )
                .font(.system(size: density == .compact ? 7 : 8, weight: .medium))
                .foregroundStyle(resolver.palette.diffAdded)
        }
        .padding(density.padding)
        .frame(width: resolver.sidebarPreviewWidth)
        .background(resolver.panelColor)
    }

    private var mainArea: some View {
        VStack(alignment: .leading, spacing: density == .compact ? 6 : 9) {
            HStack {
                Text("项目空间")
                    .font(resolver.uiFont(size: density == .compact ? 10 : 12, weight: .bold))
                    .foregroundStyle(resolver.palette.ink)
                Spacer()
                Text("WORKBUDDY")
                    .font(.system(size: density == .compact ? 6 : 7, weight: .bold))
                    .foregroundStyle(resolver.palette.skill)
            }

            WorkBuddyProjectHeroPreview(resolver: resolver, height: density == .compact ? 48 : 67)

            HStack(spacing: 6) {
                WorkBuddyPreviewCard(title: "继续任务", symbol: "arrow.right.circle", resolver: resolver)
                WorkBuddyPreviewCard(title: "新建计划", symbol: "sparkles", resolver: resolver)
            }

            composer
        }
        .padding(density.padding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var composer: some View {
        HStack(spacing: 5) {
            Text("给 WorkBuddy 发送消息…")
                .font(.system(size: density == .compact ? 7 : 9))
                .foregroundStyle(resolver.palette.ink.opacity(0.58))
                .lineLimit(1)
            Spacer(minLength: 2)
            PreviewActionButton(title: "停止", color: resolver.palette.diffRemoved, compact: density == .compact)
            PreviewActionButton(title: "发送", color: resolver.palette.accent, compact: density == .compact)
        }
        .padding(.horizontal, density == .compact ? 6 : 8)
        .padding(.vertical, density == .compact ? 5 : 7)
        .background(resolver.panelColor.opacity(0.92), in: RoundedRectangle(cornerRadius: resolver.radius * 0.65, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: resolver.radius * 0.65, style: .continuous).stroke(resolver.palette.ink.opacity(resolver.panelBorderOpacity)))
    }
}

private struct WorkBuddyPreviewTab: View {
    let title: String
    let symbol: String
    let selected: Bool
    let resolver: UnionProfilePreviewResolver

    var body: some View {
        Label(LingGlowL10n.string(title), systemImage: symbol)
            .font(.system(size: 8, weight: selected ? .semibold : .regular))
            .foregroundStyle(selected ? resolver.palette.ink : resolver.palette.ink.opacity(0.68))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .padding(.vertical, 5)
            .background(selected ? resolver.palette.accent.opacity(0.34) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

private struct WorkBuddyProjectHeroPreview: View {
    let resolver: UnionProfilePreviewResolver
    let height: CGFloat

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [resolver.palette.accent.opacity(0.72), resolver.palette.surface.opacity(0.72)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let image = resolver.image(for: "workbuddy.projectHero.image") {
                UnionProfilePreviewAsset(
                    image: image,
                    fills: resolver.imageFills("workbuddy.projectHero.fit"),
                    alignment: resolver.alignment(for: "workbuddy.projectHero.position")
                )
            }
            LinearGradient(colors: [.clear, resolver.palette.surface.opacity(0.74)], startPoint: .top, endPoint: .bottom)
            HStack {
                Text("项目 Hero")
                    .font(resolver.uiFont(size: 8, weight: .bold))
                Spacer()
                Text(resolver.string("workbuddy.projectHero.fit", fallback: "cover"))
                    .font(.system(size: 7, weight: .medium))
                    .opacity(0.78)
            }
            .foregroundStyle(resolver.palette.ink)
            .padding(7)
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: resolver.radius * 0.70, style: .continuous))
    }
}

private struct WorkBuddyPreviewCard: View {
    let title: String
    let symbol: String
    let resolver: UnionProfilePreviewResolver

    var body: some View {
        Label(LingGlowL10n.string(title), systemImage: symbol)
            .font(.system(size: 8, weight: .medium))
            .foregroundStyle(resolver.palette.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(7)
            .background(resolver.panelColor.opacity(0.92), in: RoundedRectangle(cornerRadius: resolver.radius * 0.55, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: resolver.radius * 0.55, style: .continuous).stroke(resolver.palette.ink.opacity(resolver.panelBorderOpacity)))
    }
}

private struct CodexUnionPreview: View {
    let resolver: UnionProfilePreviewResolver
    let density: UnionProfilePreviewDensity

    var body: some View {
        UnionProfilePreviewFrame(resolver: resolver, density: density) {
            HStack(spacing: 0) {
                sidebar
                Rectangle().fill(resolver.palette.ink.opacity(0.10)).frame(width: 1)
                conversation
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: density == .compact ? 6 : 9) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.system(size: density == .compact ? 9 : 11, weight: .bold))
                    .foregroundStyle(resolver.palette.accent)
                Text("Codex")
                    .font(resolver.uiFont(size: density == .compact ? 9 : 11, weight: .bold))
                    .foregroundStyle(resolver.palette.ink)
            }
            CodexPreviewSidebarRow(title: "新任务", selected: true, resolver: resolver)
            CodexPreviewSidebarRow(title: "最近项目", selected: false, resolver: resolver)
            CodexPreviewSidebarRow(title: "设置", selected: false, resolver: resolver)
            Spacer(minLength: 1)
            Text("侧栏宽度候选 \(Int(resolver.number("layout.sidebarWidth", fallback: 275, range: 240...420)))")
                .font(.system(size: density == .compact ? 6 : 7))
                .foregroundStyle(.orange.opacity(0.92))
                .lineLimit(1)
            Text(LingGlowL10n.string(resolver.windowOpaque ? "官方窗口：不透明" : "官方窗口：透明"))
                .font(.system(size: density == .compact ? 6 : 7, weight: .medium))
                .foregroundStyle(resolver.palette.ink.opacity(0.58))
                .lineLimit(1)
        }
        .padding(density.padding)
        .frame(width: resolver.sidebarPreviewWidth)
        .background(resolver.panelColor)
    }

    private var conversation: some View {
        VStack(alignment: .leading, spacing: density == .compact ? 6 : 9) {
            candidateBanner
            HStack {
                Text("本地对话预览")
                    .font(resolver.uiFont(size: density == .compact ? 10 : 12, weight: .bold))
                    .foregroundStyle(resolver.palette.ink)
                Spacer()
                Text(resolver.string("codex.codeThemeId", fallback: "codex"))
                    .font(resolver.codeFont(size: density == .compact ? 7 : 8, weight: .medium))
                    .foregroundStyle(resolver.palette.skill)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 3)
                    .background(resolver.palette.skill.opacity(0.12), in: Capsule())
            }
            messageBubble
            codeDiff
            composer
        }
        .padding(density.padding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var candidateBanner: some View {
        let enabled = resolver.bool("codex.banner.enabled", fallback: false)
        return ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [resolver.palette.accent.opacity(enabled ? 0.65 : 0.32), resolver.palette.surface.opacity(0.72)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if enabled, let image = resolver.image(for: "codex.banner.image") {
                UnionProfilePreviewAsset(image: image, fills: true, alignment: .top)
                    .opacity(resolver.number("codex.banner.opacity", fallback: 0.45, range: 0.1...0.55))
            }
            HStack {
                Label(
                    LingGlowL10n.string(enabled ? "候选 Banner · 仅本地预览" : "候选 Banner 已关闭 · 未注入"),
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.system(size: density == .compact ? 7 : 8, weight: .semibold))
                Spacer(minLength: 2)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(LingGlowL10n.string(resolver.supportStatus(for: "codex.banner.enabled") == "supported" ? "已审计" : "候选"))
                    Text(resolver.codexBannerMetadata)
                        .font(.system(size: density == .compact ? 5 : 6, weight: .medium))
                        .lineLimit(1)
                }
                    .font(.system(size: density == .compact ? 6 : 7, weight: .bold))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 3)
                    .background(Color.orange.opacity(0.18), in: Capsule())
            }
            .foregroundStyle(resolver.palette.ink)
            .padding(7)
        }
        .frame(maxWidth: .infinity)
        .frame(height: density == .compact ? min(resolver.codexBannerPreviewHeight, 42) : resolver.codexBannerPreviewHeight)
        .clipShape(RoundedRectangle(cornerRadius: resolver.radius * 0.60, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: resolver.radius * 0.60, style: .continuous).stroke(Color.orange.opacity(0.42), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    private var messageBubble: some View {
        HStack(alignment: .top, spacing: 6) {
            Circle().fill(resolver.palette.accent).frame(width: 15, height: 15)
                .overlay(Image(systemName: "sparkles").font(.system(size: 7)).foregroundStyle(.white))
            Text("我会保留你的皮肤字段，并只在审计通过后应用它们。")
                .font(resolver.uiFont(size: density == .compact ? 7 : 9))
                .foregroundStyle(resolver.palette.ink)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(7)
        .background(resolver.panelColor.opacity(0.92), in: RoundedRectangle(cornerRadius: resolver.radius * 0.55, style: .continuous))
    }

    private var codeDiff: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3).fill(resolver.palette.diffAdded).frame(width: 4)
            Text("+ preview = localOnly")
                .font(resolver.codeFont(size: density == .compact ? 6 : 7))
                .foregroundStyle(resolver.palette.diffAdded)
            RoundedRectangle(cornerRadius: 3).fill(resolver.palette.diffRemoved).frame(width: 4)
            Text("- inject")
                .font(resolver.codeFont(size: density == .compact ? 6 : 7))
                .foregroundStyle(resolver.palette.diffRemoved)
            Spacer(minLength: 0)
        }
        .padding(6)
        .background(resolver.palette.surface.opacity(0.78), in: RoundedRectangle(cornerRadius: resolver.radius * 0.48, style: .continuous))
    }

    private var composer: some View {
        HStack(spacing: 5) {
            Text("给 Codex 发送消息…")
                .font(.system(size: density == .compact ? 7 : 9))
                .foregroundStyle(resolver.palette.ink.opacity(0.58))
                .lineLimit(1)
            Spacer(minLength: 2)
            PreviewActionButton(title: "停止", color: resolver.palette.diffRemoved, compact: density == .compact)
            PreviewActionButton(title: "发送", color: resolver.palette.accent, compact: density == .compact)
        }
        .padding(.horizontal, density == .compact ? 6 : 8)
        .padding(.vertical, density == .compact ? 5 : 7)
        .background(resolver.panelColor.opacity(0.94), in: RoundedRectangle(cornerRadius: resolver.radius * 0.65, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: resolver.radius * 0.65, style: .continuous).stroke(resolver.palette.ink.opacity(resolver.panelBorderOpacity)))
    }
}

private struct CodexPreviewSidebarRow: View {
    let title: String
    let selected: Bool
    let resolver: UnionProfilePreviewResolver

    var body: some View {
        Text(LingGlowL10n.string(title))
            .font(.system(size: 8, weight: selected ? .semibold : .regular))
            .foregroundStyle(selected ? resolver.palette.ink : resolver.palette.ink.opacity(0.68))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .padding(.vertical, 5)
            .background(selected ? resolver.palette.accent.opacity(0.28) : .clear, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

private struct DoubaoDesignUnionPreview: View {
    let resolver: UnionProfilePreviewResolver
    let density: UnionProfilePreviewDensity

    var body: some View {
        UnionProfilePreviewFrame(resolver: resolver, density: density) {
            VStack(alignment: .leading, spacing: density == .compact ? 6 : 9) {
                Label("仅设计草图：未启动、未连接、未注入豆包", systemImage: "lock.shield.fill")
                    .font(.system(size: density == .compact ? 7 : 9, weight: .bold))
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 5)
                    .background(Color.orange.opacity(0.13), in: Capsule())

                hero
                cards
                designComposer
            }
        }
    }

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [resolver.palette.accent.opacity(0.78), resolver.palette.skill.opacity(0.44), resolver.palette.surface.opacity(0.85)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let image = resolver.image(for: "doubao.homeHero.image") {
                UnionProfilePreviewAsset(
                    image: image,
                    fills: resolver.imageFills("doubao.homeHero.fit"),
                    alignment: resolver.alignment(for: "doubao.homeHero.position")
                )
            }
            LinearGradient(colors: [.clear, resolver.palette.surface.opacity(0.78)], startPoint: .top, endPoint: .bottom)

            HStack(alignment: .bottom, spacing: 8) {
                DoubaoPreviewAvatar(resolver: resolver, size: density == .compact ? 29 : 38)
                VStack(alignment: .leading, spacing: 1) {
                    Text("你好，我是你的豆包设计草图")
                        .font(resolver.uiFont(size: density == .compact ? 8 : 10, weight: .bold))
                    Text("Hero / Avatar 均仅在灵妆本地展示")
                        .font(.system(size: density == .compact ? 6 : 7))
                        .opacity(0.82)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(resolver.palette.ink)
            .padding(8)
        }
        .frame(maxWidth: .infinity)
        .frame(height: density == .compact ? 62 : 83)
        .clipShape(RoundedRectangle(cornerRadius: resolver.radius * 0.75, style: .continuous))
    }

    private var cards: some View {
        HStack(spacing: 6) {
            DoubaoPreviewCard(title: "灵感", symbol: "sparkles", resolver: resolver)
            DoubaoPreviewCard(title: "总结", symbol: "text.alignleft", resolver: resolver)
            DoubaoPreviewCard(title: "创作", symbol: "paintbrush", resolver: resolver)
        }
    }

    private var designComposer: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock.fill")
                .font(.system(size: density == .compact ? 7 : 8))
                .foregroundStyle(.orange)
            Text("仅展示输入框设计，不会向豆包发送任何内容")
                .font(.system(size: density == .compact ? 7 : 8))
                .foregroundStyle(resolver.palette.ink.opacity(0.72))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, density == .compact ? 5 : 7)
        .background(resolver.panelColor.opacity(0.94), in: RoundedRectangle(cornerRadius: resolver.radius * 0.62, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: resolver.radius * 0.62, style: .continuous).stroke(Color.orange.opacity(0.28)))
    }
}

private struct DoubaoPreviewAvatar: View {
    let resolver: UnionProfilePreviewResolver
    let size: CGFloat

    var body: some View {
        Group {
            if let image = resolver.image(for: "doubao.assistantAvatar.image") {
                UnionProfilePreviewAsset(
                    image: image,
                    fills: resolver.imageFills("doubao.assistantAvatar.fit"),
                    alignment: .center
                )
            } else {
                Image(systemName: "sparkles")
                    .font(.system(size: size * 0.43, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(resolver.palette.accent)
            }
        }
        .frame(width: size, height: size)
        .clipShape(avatarShape)
        .overlay(avatarShape.stroke(resolver.palette.ink.opacity(0.42), lineWidth: 1))
    }

    private var avatarShape: RoundedRectangle {
        switch resolver.string("doubao.assistantAvatar.shape", fallback: "circle") {
        case "square":
            return RoundedRectangle(cornerRadius: 2, style: .continuous)
        case "rounded":
            return RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        default:
            // A rounded rectangle with half the side length is geometrically a
            // circle while letting clipShape and overlay share the same type.
            return RoundedRectangle(cornerRadius: size / 2, style: .continuous)
        }
    }
}

private struct DoubaoPreviewCard: View {
    let title: String
    let symbol: String
    let resolver: UnionProfilePreviewResolver

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(resolver.palette.accent)
            Text(LingGlowL10n.string(title))
                .font(resolver.uiFont(size: 7, weight: .medium))
                .foregroundStyle(resolver.palette.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(7)
        .background(resolver.panelColor.opacity(0.91), in: RoundedRectangle(cornerRadius: resolver.radius * 0.52, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: resolver.radius * 0.52, style: .continuous).stroke(resolver.palette.ink.opacity(resolver.panelBorderOpacity)))
    }
}

private struct UnionProfilePreviewFrame<Content: View>: View {
    let resolver: UnionProfilePreviewResolver
    let density: UnionProfilePreviewDensity
    let content: Content

    init(
        resolver: UnionProfilePreviewResolver,
        density: UnionProfilePreviewDensity,
        @ViewBuilder content: () -> Content
    ) {
        self.resolver = resolver
        self.density = density
        self.content = content()
    }

    var body: some View {
        ZStack {
            resolver.palette.surface
            if let image = resolver.backgroundImage {
                UnionProfilePreviewAsset(
                    image: image,
                    fills: true,
                    alignment: resolver.backgroundAlignment
                )
                    .opacity(resolver.backgroundOpacity)
                    .blur(radius: resolver.backgroundBlur)
            }
            resolver.palette.surface.opacity(resolver.backgroundOverlay)
            content
        }
        .frame(maxWidth: .infinity)
        .frame(height: density.canvasHeight)
        .clipShape(RoundedRectangle(cornerRadius: resolver.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: resolver.radius, style: .continuous).stroke(resolver.palette.ink.opacity(resolver.panelBorderOpacity)))
    }
}

private struct UnionProfilePreviewAsset: View {
    let image: NSImage
    let fills: Bool
    let alignment: Alignment

    var body: some View {
        Image(nsImage: image)
            .resizable()
            .aspectRatio(contentMode: fills ? .fill : .fit)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
            .clipped()
    }
}

private struct UnionProfilePreviewBrandMark: View {
    let brand: UnionProfilePreviewBrand
    let palette: UnionProfilePreviewPalette

    var body: some View {
        Group {
            if let image = brand.iconImage {
                UnionProfilePreviewAsset(image: image, fills: true, alignment: .center)
            } else {
                Text(brand.shortMark)
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(palette.accent)
            }
        }
        .clipShape(markShape)
        .overlay(markShape.stroke(palette.ink.opacity(0.24), lineWidth: 1))
        .accessibilityLabel("品牌图标：\(brand.displayName)")
    }

    private var markShape: RoundedRectangle {
        switch brand.style {
        case "circle":
            return RoundedRectangle(cornerRadius: 999, style: .continuous)
        case "diamond":
            return RoundedRectangle(cornerRadius: 4, style: .continuous)
        case "tile":
            return RoundedRectangle(cornerRadius: 5, style: .continuous)
        default:
            return RoundedRectangle(cornerRadius: 6, style: .continuous)
        }
    }
}

private struct PreviewActionButton: View {
    let title: String
    let color: Color
    let compact: Bool

    var body: some View {
        Text(LingGlowL10n.string(title))
            .font(.system(size: compact ? 6 : 7, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, compact ? 5 : 6)
            .padding(.vertical, compact ? 3 : 4)
            .background(color, in: Capsule())
    }
}

private enum UnionProfilePreviewColor {
    static func make(_ hex: String, fallback: Color) -> Color {
        var normalized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.hasPrefix("#") { normalized.removeFirst() }
        if normalized.count == 3 {
            normalized = normalized.map { "\($0)\($0)" }.joined()
        }
        guard normalized.count == 6 || normalized.count == 8,
              let value = UInt64(normalized, radix: 16) else {
            return fallback
        }

        let hasAlpha = normalized.count == 8
        let red: UInt64
        let green: UInt64
        let blue: UInt64
        let alpha: UInt64
        if hasAlpha {
            red = (value >> 24) & 0xFF
            green = (value >> 16) & 0xFF
            blue = (value >> 8) & 0xFF
            alpha = value & 0xFF
        } else {
            red = (value >> 16) & 0xFF
            green = (value >> 8) & 0xFF
            blue = value & 0xFF
            alpha = 0xFF
        }
        return Color(
            .sRGB,
            red: Double(red) / 255,
            green: Double(green) / 255,
            blue: Double(blue) / 255,
            opacity: Double(alpha) / 255
        )
    }
}

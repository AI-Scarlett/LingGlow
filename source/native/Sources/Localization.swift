import Foundation

/// App-owned localization for strings that SwiftUI receives dynamically.
///
/// SwiftUI localizes string literals through the environment locale, but a
/// value such as `tab.title`, a backend status message, or an AppKit menu title
/// is otherwise rendered verbatim.  Keeping this lookup beside the selected
/// app language makes those paths switch immediately as well, without changing
/// the process-wide `AppleLanguages` setting or requiring a relaunch.
enum LingGlowL10n {
    static let preferenceKey = "LingGlowPreferredLanguage"

    static var currentLanguage: String {
        if let saved = UserDefaults.standard.string(forKey: preferenceKey),
           saved == "en" || saved == "zh-Hans" {
            return saved
        }
        return Locale.preferredLanguages.first?.hasPrefix("en") == true ? "en" : "zh-Hans"
    }

    static func string(_ key: String, _ arguments: CVarArg...) -> String {
        let format: String
        if currentLanguage == "en",
           let path = Bundle.main.path(forResource: "en", ofType: "lproj"),
           let bundle = Bundle(path: path) {
            format = bundle.localizedString(forKey: key, value: key, table: nil)
        } else {
            format = key
        }
        guard !arguments.isEmpty else { return format }
        return String(
            format: format,
            locale: Locale(identifier: currentLanguage == "en" ? "en_US" : "zh_CN"),
            arguments: arguments
        )
    }

    /// Backend and runtime failures can include interpolated diagnostics, so
    /// they cannot always be looked up as an exact `.strings` key. Keep those
    /// details useful when a known pattern is available and never leak an
    /// untranslated internal Chinese diagnostic into the English interface.
    static func error(_ message: String) -> String {
        guard currentLanguage == "en" else { return message }

        let startupPrefix = "内置服务启动失败："
        if message.hasPrefix(startupPrefix) {
            let diagnostic = String(message.dropFirst(startupPrefix.count))
            return string("内置服务启动失败：%@", error(diagnostic))
        }

        let translated = string(message)
        if translated != message || !containsHan(message) {
            return translated
        }
        return string("操作失败，请稍后重试")
    }

    private static func containsHan(_ value: String) -> Bool {
        value.unicodeScalars.contains { scalar in
            (0x3400...0x4DBF).contains(scalar.value)
                || (0x4E00...0x9FFF).contains(scalar.value)
        }
    }
}

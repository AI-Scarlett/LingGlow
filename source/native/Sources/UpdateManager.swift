import AppKit
import CryptoKit
import Foundation

struct LingGlowUpdateArtifact: Decodable, Sendable {
    let dmgURL: String
    let sha256: String
}

struct LingGlowUpdateManifest: Decodable, Sendable {
    let version: String
    let tag: String
    let dmgURL: String?
    let sha256: String?
    let artifacts: [String: LingGlowUpdateArtifact]?
    let bundleIdentifier: String
    let teamIdentifier: String
    let minimumSystemVersion: String
    let releaseNotes: String?
    let releaseNotesEn: String?

    var localizedReleaseNotes: String? {
        LingGlowL10n.currentLanguage == "en" ? (releaseNotesEn ?? releaseNotes) : releaseNotes
    }

    var selectedArtifact: LingGlowUpdateArtifact? {
#if arch(arm64)
        let architecture = "arm64"
#else
        let architecture = "x86_64"
#endif
        if let artifact = artifacts?[architecture] { return artifact }
        guard let dmgURL, let sha256 else { return nil }
        return LingGlowUpdateArtifact(dmgURL: dmgURL, sha256: sha256)
    }
}

enum LingGlowUpdateError: LocalizedError {
    case invalidManifest(String)
    case network(String)
    case integrity
    case verification(String)
    case installation(String)

    var errorDescription: String? {
        switch self {
        case let .invalidManifest(message): return LingGlowL10n.string("更新清单无效：%@", LingGlowL10n.string(message))
        case let .network(message): return LingGlowL10n.string("更新下载失败：%@", LingGlowL10n.string(message))
        case .integrity: return LingGlowL10n.string("更新文件 SHA-256 不匹配，已拒绝安装。")
        case let .verification(message): return LingGlowL10n.string("更新签名校验失败：%@", LingGlowL10n.string(message))
        case let .installation(message): return LingGlowL10n.string("无法启动安全安装程序：%@", LingGlowL10n.string(message))
        }
    }
}

final class LingGlowUpdateManager {
    static let shared = LingGlowUpdateManager()

    private static let manifestURL = URL(
        string: "https://raw.githubusercontent.com/AI-Scarlett/LingGlow/main/latest.json"
    )!
    private static let expectedBundleIdentifier = "local.skin-studio.menubar"
    private static let expectedTeamIdentifier = "UQ87N2WZ76"
    private static let automaticUpdatesKey = "LingGlowAutomaticUpdatesEnabled"

    var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    var automaticUpdatesEnabled: Bool {
        get {
            let defaults = UserDefaults.standard
            guard defaults.object(forKey: Self.automaticUpdatesKey) != nil else {
                return true
            }
            return defaults.bool(forKey: Self.automaticUpdatesKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: Self.automaticUpdatesKey) }
    }

    func availableUpdate() async throws -> LingGlowUpdateManifest? {
        var request = URLRequest(url: Self.manifestURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 20
        request.setValue("LingGlow/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw LingGlowUpdateError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw LingGlowUpdateError.network("服务器没有返回有效更新清单。")
        }
        let manifest: LingGlowUpdateManifest
        do {
            manifest = try JSONDecoder().decode(LingGlowUpdateManifest.self, from: data)
        } catch {
            throw LingGlowUpdateError.invalidManifest(error.localizedDescription)
        }
        try validate(manifest)
        guard currentVersion.compare(manifest.version, options: .numeric) == .orderedAscending else {
            return nil
        }
        return manifest
    }

    func downloadVerifyAndInstall(_ manifest: LingGlowUpdateManifest) async throws {
        try validate(manifest)
        guard let artifact = manifest.selectedArtifact,
              let url = URL(string: artifact.dmgURL) else {
            throw LingGlowUpdateError.invalidManifest("DMG 地址无法解析。")
        }
        let downloaded: URL
        let response: URLResponse
        do {
            (downloaded, response) = try await URLSession.shared.download(from: url)
        } catch {
            throw LingGlowUpdateError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw LingGlowUpdateError.network("DMG 下载响应无效。")
        }

        let installer = try await Task.detached(priority: .userInitiated) {
            try Self.prepareInstaller(downloadedDMG: downloaded, manifest: manifest)
        }.value

        try await MainActor.run {
            try Self.launchInstaller(installer)
        }
    }

    private func validate(_ manifest: LingGlowUpdateManifest) throws {
        guard manifest.bundleIdentifier == Self.expectedBundleIdentifier else {
            throw LingGlowUpdateError.invalidManifest("Bundle ID 不匹配。")
        }
        guard manifest.teamIdentifier == Self.expectedTeamIdentifier else {
            throw LingGlowUpdateError.invalidManifest("Developer Team ID 不匹配。")
        }
        guard let artifact = manifest.selectedArtifact else {
            throw LingGlowUpdateError.invalidManifest("没有适用于当前 Mac 的安装包。")
        }
        guard artifact.sha256.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else {
            throw LingGlowUpdateError.invalidManifest("SHA-256 格式错误。")
        }
        guard let url = URL(string: artifact.dmgURL),
              url.scheme == "https",
              url.host == "github.com",
              url.path.hasPrefix("/AI-Scarlett/LingGlow/releases/download/") else {
            throw LingGlowUpdateError.invalidManifest("下载地址不属于官方 GitHub Release。")
        }
        let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        _ = osVersion
    }

    private struct InstallerLaunch: Sendable {
        let helperURL: URL
        let requiresAdministrator: Bool
    }

    private static func prepareInstaller(
        downloadedDMG: URL,
        manifest: LingGlowUpdateManifest
    ) throws -> InstallerLaunch {
        let data = try Data(contentsOf: downloadedDMG, options: .mappedIfSafe)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard let artifact = manifest.selectedArtifact,
              digest.caseInsensitiveCompare(artifact.sha256) == .orderedSame else {
            throw LingGlowUpdateError.integrity
        }

        let workURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("LingGlowUpdate-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workURL, withIntermediateDirectories: true)
        // A failed download, integrity check or verification must not leave a
        // full DMG plus a staged app behind; the installer script owns the
        // cleanup of a successfully staged directory.
        var stagingCompleted = false
        defer {
            if !stagingCompleted {
                try? FileManager.default.removeItem(at: workURL)
            }
        }
        let dmgURL = workURL.appendingPathComponent("LingGlow-update.dmg")
        try FileManager.default.copyItem(at: downloadedDMG, to: dmgURL)

        let attach = try run(
            "/usr/bin/hdiutil",
            ["attach", "-nobrowse", "-readonly", "-plist", dmgURL.path]
        )
        guard let plist = try PropertyListSerialization.propertyList(
            from: attach.stdout,
            options: [],
            format: nil
        ) as? [String: Any],
        let entities = plist["system-entities"] as? [[String: Any]],
        let mountPath = entities.compactMap({ $0["mount-point"] as? String }).first else {
            throw LingGlowUpdateError.verification("无法挂载更新镜像。")
        }
        let mountURL = URL(fileURLWithPath: mountPath, isDirectory: true)

        do {
            let sourceApp = mountURL.appendingPathComponent("灵妆.app", isDirectory: true)
            guard FileManager.default.fileExists(atPath: sourceApp.path) else {
                throw LingGlowUpdateError.verification("镜像内缺少灵妆.app。")
            }
            guard Bundle(url: sourceApp)?.bundleIdentifier == manifest.bundleIdentifier else {
                throw LingGlowUpdateError.verification("应用 Bundle ID 不匹配。")
            }
            _ = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", sourceApp.path])
            let details = try run("/usr/bin/codesign", ["-dv", "--verbose=4", sourceApp.path])
            let signatureText = String(data: details.stderr, encoding: .utf8) ?? ""
            guard signatureText.contains("TeamIdentifier=\(manifest.teamIdentifier)") else {
                throw LingGlowUpdateError.verification("Developer ID 发布者不匹配。")
            }
            _ = try run(
                "/usr/sbin/spctl",
                ["--assess", "--type", "execute", "--verbose=2", sourceApp.path]
            )

            let stagedApp = workURL.appendingPathComponent("灵妆.app", isDirectory: true)
            _ = try run("/usr/bin/ditto", [sourceApp.path, stagedApp.path])
            _ = try run("/usr/bin/hdiutil", ["detach", mountPath])

            let targetApp = Bundle.main.bundleURL
            let helperURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("lingglow-updater-\(UUID().uuidString).zsh")
            let backupPath = targetApp.path + ".previous-update"
            let script = """
            #!/bin/zsh
            set -euo pipefail
            while /bin/kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do /bin/sleep 0.25; done
            /bin/rm -rf \(shellQuote(backupPath))
            /bin/mv \(shellQuote(targetApp.path)) \(shellQuote(backupPath))
            if /usr/bin/ditto \(shellQuote(stagedApp.path)) \(shellQuote(targetApp.path)) \\
              && /usr/bin/codesign --verify --deep --strict \(shellQuote(targetApp.path)) \\
              && /usr/sbin/spctl --assess --type execute \(shellQuote(targetApp.path)); then
              /usr/bin/open \(shellQuote(targetApp.path))
              /bin/rm -rf \(shellQuote(backupPath)) \(shellQuote(workURL.path))
              /bin/rm -f "$0"
              exit 0
            fi
            /bin/rm -rf \(shellQuote(targetApp.path))
            /bin/mv \(shellQuote(backupPath)) \(shellQuote(targetApp.path))
            /bin/rm -rf \(shellQuote(workURL.path))
            /bin/rm -f "$0"
            exit 1
            """
            try script.write(to: helperURL, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: helperURL.path
            )
            let writable = FileManager.default.isWritableFile(
                atPath: targetApp.deletingLastPathComponent().path
            )
            stagingCompleted = true
            return InstallerLaunch(helperURL: helperURL, requiresAdministrator: !writable)
        } catch {
            _ = try? run("/usr/bin/hdiutil", ["detach", mountPath])
            throw error
        }
    }

    @MainActor
    private static func launchInstaller(_ installer: InstallerLaunch) throws {
        let process = Process()
        if installer.requiresAdministrator {
            let command = "/bin/zsh \(shellQuote(installer.helperURL.path))"
            let escaped = command
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-e", "do shell script \"\(escaped)\" with administrator privileges"]
        } else {
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = [installer.helperURL.path]
        }
        do {
            try process.run()
        } catch {
            throw LingGlowUpdateError.installation(error.localizedDescription)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApp.terminate(nil)
        }
    }

    private struct ProcessOutput {
        let stdout: Data
        let stderr: Data
    }

    /// Each buffer is written by exactly one drain block and read only after
    /// the group has completed.
    private final class ProcessOutputBuffer: @unchecked Sendable {
        var data = Data()
    }

    @discardableResult
    private static func run(_ executable: String, _ arguments: [String]) throws -> ProcessOutput {
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        // Drain both pipes before waiting: a child that fills a pipe buffer
        // would otherwise block on write while we block on exit.
        let collected = DispatchGroup()
        let drain = DispatchQueue(label: "local.skin-studio.update-process", attributes: .concurrent)
        let collectedStdout = ProcessOutputBuffer()
        let collectedStderr = ProcessOutputBuffer()
        drain.async(group: collected) {
            collectedStdout.data = stdout.fileHandleForReading.readDataToEndOfFile()
        }
        drain.async(group: collected) {
            collectedStderr.data = stderr.fileHandleForReading.readDataToEndOfFile()
        }
        collected.wait()
        process.waitUntilExit()
        let output = ProcessOutput(stdout: collectedStdout.data, stderr: collectedStderr.data)
        guard process.terminationStatus == 0 else {
            let message = String(data: output.stderr, encoding: .utf8) ?? executable
            throw LingGlowUpdateError.verification(message.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return output
    }

    private static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }
}

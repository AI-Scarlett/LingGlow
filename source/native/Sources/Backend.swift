import CryptoKit
import Darwin
import Foundation

enum NativeStudioError: LocalizedError {
    case unsafeSession(String)
    case backendUnavailable(String)
    case foreignRuntimeConflict(ForeignRuntimeConflict)
    case invalidResponse
    case api(status: Int, message: String, code: String?)

    var errorDescription: String? {
        switch self {
        case .unsafeSession(let message): return LingGlowL10n.error(message)
        case .backendUnavailable(let message): return LingGlowL10n.error(message)
        case .foreignRuntimeConflict:
            return LingGlowL10n.string("灵妆正在自动接管内置功能，请稍候。")
        case .invalidResponse: return LingGlowL10n.string("本地服务返回了无法识别的数据")
        case .api(_, let message, _): return LingGlowL10n.error(message)
        }
    }
}

struct ForeignRuntimeConflict {
    let lock: SessionLock
    let studioRuntimeIdentity: String?
}

private struct PackagedRuntime {
    let root: URL
    let identity: String
}

/// The backend is intentionally allowed to outlive the popover while it owns
/// an active skin session. This manifest prevents a newer native app from
/// quietly attaching to that older process and interpreting its catalog or
/// capability schema as if it came from the new signed bundle.
private enum PackagedRuntimeIdentity {
    private static let fileName = "runtime-identity.txt"
    private static let header = "lingglow-runtime-identity-v1"
    private static let maxBytes = 512 * 1024
    private static let maxEntries = 2_048

    static func verified(at root: URL) throws -> String {
        let manifest = root.appendingPathComponent(fileName, isDirectory: false).standardizedFileURL
        guard manifest.deletingLastPathComponent() == root.standardizedFileURL else {
            throw NativeStudioError.backendUnavailable("灵妆运行时身份路径无效")
        }
        var information = stat()
        guard lstat(manifest.path, &information) == 0,
              (information.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              information.st_uid == geteuid() || information.st_uid == 0,
              information.st_size > 0,
              information.st_size <= maxBytes,
              (information.st_mode & 0o022) == 0 else {
            throw NativeStudioError.backendUnavailable("灵妆运行时身份清单未通过安全检查")
        }

        let text: String
        do {
            text = try String(contentsOf: manifest, encoding: .utf8)
        } catch {
            throw NativeStudioError.backendUnavailable("无法读取灵妆运行时身份清单")
        }
        guard text.hasSuffix("\n") else {
            throw NativeStudioError.backendUnavailable("灵妆运行时身份清单格式无效")
        }
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.popLast() == "", lines.count >= 3,
              String(lines[0]) == header,
              isHexDigest(String(lines[1])) else {
            throw NativeStudioError.backendUnavailable("灵妆运行时身份清单格式无效")
        }

        let expectedIdentity = String(lines[1])
        var entries: [(relativePath: String, sha256: String)] = []
        var seenPaths = Set<String>()
        var canonical = ""
        for rawLine in lines.dropFirst(2) {
            let line = String(rawLine)
            guard line.count > 66,
                  isHexDigest(String(line.prefix(64))),
                  line.dropFirst(64).hasPrefix("  ") else {
                throw NativeStudioError.backendUnavailable("灵妆运行时身份条目无效")
            }
            let relativePath = String(line.dropFirst(66))
            guard safeRelativePath(relativePath), seenPaths.insert(relativePath).inserted else {
                throw NativeStudioError.backendUnavailable("灵妆运行时身份条目不安全")
            }
            entries.append((relativePath: relativePath, sha256: String(line.prefix(64))))
            canonical += "\(line)\n"
        }
        guard !entries.isEmpty, entries.count <= maxEntries,
              sha256Hex(Data(canonical.utf8)) == expectedIdentity else {
            throw NativeStudioError.backendUnavailable("灵妆运行时身份摘要不匹配")
        }

        for entry in entries {
            let file = root.appendingPathComponent(entry.relativePath, isDirectory: false).standardizedFileURL
            guard file.path.hasPrefix("\(root.path)/") else {
                throw NativeStudioError.backendUnavailable("灵妆运行时身份路径越界")
            }
            var fileInformation = stat()
            guard lstat(file.path, &fileInformation) == 0,
                  (fileInformation.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
                  fileInformation.st_uid == geteuid() || fileInformation.st_uid == 0,
                  (fileInformation.st_mode & 0o022) == 0 else {
                throw NativeStudioError.backendUnavailable("灵妆运行时文件未通过安全检查")
            }
            let data: Data
            do {
                data = try Data(contentsOf: file, options: .mappedIfSafe)
            } catch {
                throw NativeStudioError.backendUnavailable("无法校验灵妆运行时文件")
            }
            guard sha256Hex(data) == entry.sha256 else {
                throw NativeStudioError.backendUnavailable("灵妆运行时文件摘要不匹配")
            }
        }
        return expectedIdentity
    }

    private static func safeRelativePath(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 4_096,
              !value.contains("\\"),
              value.unicodeScalars.allSatisfy({ scalar in
                  scalar.value >= 0x20 && scalar.value != 0x7f &&
                  ((scalar.value >= 0x30 && scalar.value <= 0x39) ||
                   (scalar.value >= 0x41 && scalar.value <= 0x5a) ||
                   (scalar.value >= 0x61 && scalar.value <= 0x7a) ||
                   scalar == "." || scalar == "_" || scalar == "-" || scalar == "/")
              }) else {
            return false
        }
        let segments = value.split(separator: "/", omittingEmptySubsequences: false)
        return !segments.isEmpty && segments.allSatisfy { segment in
            !segment.isEmpty && segment != "." && segment != ".."
        }
    }

    static func isHexDigest(_ value: String?) -> Bool {
        guard let value, value.count == 64 else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            (scalar.value >= 0x30 && scalar.value <= 0x39) ||
            (scalar.value >= 0x61 && scalar.value <= 0x66)
        }
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

enum PrivateSessionReader {
    static var lockURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("Codex Skin Studio", isDirectory: true)
            .appendingPathComponent("studio-session.json", isDirectory: false)
    }

    static func read() throws -> SessionLock {
        let path = lockURL.path
        var first = stat()
        guard lstat(path, &first) == 0 else {
            if errno == ENOENT {
                throw NativeStudioError.backendUnavailable("本地服务尚未就绪")
            }
            throw NativeStudioError.unsafeSession("无法检查本地会话文件")
        }

        guard (first.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              first.st_uid == geteuid(),
              first.st_nlink == 1,
              first.st_size > 0,
              first.st_size <= 16 * 1024,
              (first.st_mode & 0o777) == 0o600 else {
            throw NativeStudioError.unsafeSession("本地会话文件的类型、所有者或权限不安全")
        }

        let descriptor = Darwin.open(path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else {
            throw NativeStudioError.unsafeSession("无法安全打开本地会话文件")
        }
        defer { Darwin.close(descriptor) }

        var opened = stat()
        guard fstat(descriptor, &opened) == 0,
              opened.st_dev == first.st_dev,
              opened.st_ino == first.st_ino,
              (opened.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              opened.st_uid == geteuid(),
              opened.st_nlink == 1,
              opened.st_size == first.st_size,
              (opened.st_mode & 0o777) == 0o600 else {
            throw NativeStudioError.unsafeSession("本地会话文件在读取期间发生变化")
        }

        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
        let data: Data
        do {
            data = try handle.read(upToCount: 16 * 1024 + 1) ?? Data()
        } catch {
            throw NativeStudioError.unsafeSession("无法读取本地会话文件")
        }
        guard !data.isEmpty, data.count <= 16 * 1024 else {
            throw NativeStudioError.unsafeSession("本地会话文件大小无效")
        }

        let lock: SessionLock
        do {
            lock = try JSONDecoder().decode(SessionLock.self, from: data)
        } catch {
            throw NativeStudioError.unsafeSession("本地会话文件格式无效")
        }

        guard lock.schemaVersion == 1,
              lock.host == "127.0.0.1",
              (1...65_535).contains(lock.port),
              lock.pid > 1,
              lock.instanceId.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
              lock.token.range(of: "^[A-Za-z0-9_-]{40,50}$", options: .regularExpression) != nil,
              lock.runtimeIdentity == nil || PackagedRuntimeIdentity.isHexDigest(lock.runtimeIdentity) else {
            throw NativeStudioError.unsafeSession("本地会话文件内容未通过安全校验")
        }

        if Darwin.kill(lock.pid, 0) != 0 && errno != EPERM {
            throw NativeStudioError.backendUnavailable("本地服务进程已经结束")
        }
        return lock
    }

    static func removeLock() throws {
        let path = lockURL.path
        var information = stat()
        guard lstat(path, &information) == 0 else {
            if errno == ENOENT { return }
            throw NativeStudioError.unsafeSession("无法检查本地会话文件")
        }
        guard (information.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              information.st_uid == geteuid(),
              information.st_nlink == 1,
              (information.st_mode & 0o777) == 0o600 else {
            throw NativeStudioError.unsafeSession("本地会话文件不安全，未清理")
        }
        let handle = Darwin.open(path, O_WRONLY | O_NOFOLLOW | O_CLOEXEC)
        guard handle >= 0 else {
            throw NativeStudioError.unsafeSession("无法安全清理本地会话文件")
        }
        close(handle)
        do {
            try FileManager.default.removeItem(atPath: path)
        } catch {
            throw NativeStudioError.unsafeSession("清理本地会话文件失败")
        }
    }
}

private final class LoopbackRedirectBlocker: NSObject, URLSessionTaskDelegate {
    // The local bearer token must never be replayed to a redirect target. A
    // valid LingGlow backend has no reason to redirect any /api request.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

final class LocalAPI {
    let lock: SessionLock
    private let session: URLSession
    private let redirectBlocker: LoopbackRedirectBlocker
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(lock: SessionLock) {
        self.lock = lock
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        // Applying a skin may include a graceful quit, a signed-app
        // revalidation and a bounded renderer probe.  Keep the session-wide
        // ceiling above the explicit confirmation timeout below; ordinary
        // requests still retain their much shorter per-request limits.
        configuration.timeoutIntervalForResource = 150
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        // Do not inherit a system HTTP(S) proxy for the bearer-token-protected
        // loopback API. Redirects are independently refused below.
        configuration.connectionProxyDictionary = [:]
        self.redirectBlocker = LoopbackRedirectBlocker()
        self.session = URLSession(
            configuration: configuration,
            delegate: redirectBlocker,
            delegateQueue: nil
        )
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    /// A LingGlow UI can outlive the backend instance it first connected to.
    /// Version handoff, login-reminder takeover, or bounded crash recovery may
    /// replace the private session manifest while the window remains open.
    /// Never send a new operation through that stale bearer/port pair.
    func matchesCurrentSessionManifest() -> Bool {
        guard let current = try? PrivateSessionReader.read() else { return false }
        return current.pid == lock.pid &&
            current.port == lock.port &&
            current.instanceId == lock.instanceId &&
            current.runtimeIdentity == lock.runtimeIdentity
    }

    func status() async throws -> StudioStatusResponse {
        try await request(path: "/api/status")
    }

    func doctorRefresh(client: ClientID? = nil) async throws -> StudioStatusResponse {
        try await request(
            path: "/api/doctor/refresh",
            method: "POST",
            body: DoctorRefreshRequest(clientId: client?.rawValue),
            timeoutInterval: 30
        )
    }

    func catalog(for client: ClientID, manuallySyncingTemplates: Bool = false) async throws -> CatalogResponse {
        try await request(
            path: "/api/catalog",
            queryItems: [
                URLQueryItem(name: "clientId", value: client.rawValue),
                URLQueryItem(name: "refresh", value: manuallySyncingTemplates ? "manual" : "automatic"),
                // Gallery previews are loaded and cached independently. Avoid
                // blocking navigation on repeated multi-megabyte Base64 art.
                URLQueryItem(name: "artwork", value: "summary"),
            ]
        )
    }

    func installRemoteSkin(_ skinId: String, for client: ClientID) async throws -> RemoteSkinInstallResponse {
        try await request(
            path: "/api/catalog/install",
            queryItems: [URLQueryItem(name: "artwork", value: "summary")],
            method: "POST",
            body: RemoteSkinInstallRequest(skinId: skinId, clientId: client.rawValue),
            timeoutInterval: 45
        )
    }

    func profiles() async throws -> ProfilesResponse {
        try await request(path: "/api/profiles")
    }

    func products() async throws -> ProductCatalogResponse {
        try await request(path: "/api/products")
    }

    func capabilitySchema(for client: ClientID) async throws -> CapabilitySchemaResponse {
        try await request(
            path: "/api/capability-schema",
            queryItems: [URLQueryItem(name: "clientId", value: client.rawValue)]
        )
    }

    func unionProfiles(for client: ClientID? = nil) async throws -> UnionProfilesResponse {
        let query = client.map { [URLQueryItem(name: "clientId", value: $0.rawValue)] } ?? []
        return try await request(path: "/api/union-profiles", queryItems: query)
    }

    /// Export only a persisted Codex union profile as the official theme text.
    /// This is a read-only local API request; it neither starts nor controls
    /// Codex, and the native caller puts the returned string on the clipboard
    /// for the user to import manually in Codex.
    func codexOfficialTheme(for profile: UnionProfile) async throws -> CodexOfficialThemeExportResponse {
        guard profile.targetClientId == ClientID.codex.rawValue,
              profile.id.range(of: "^[a-z0-9][a-z0-9-]{0,47}$", options: .regularExpression) != nil else {
            throw NativeStudioError.backendUnavailable("只能导出已保存的 Codex 自定义皮肤")
        }
        return try await request(
            path: "/api/union-profiles/\(profile.id)/codex-official-theme"
        )
    }

    /// Read the separate, design-only store for currently blocked Agents.
    /// These records use the same union profile schema, but the endpoint is
    /// intentionally not the executable /api/union-profiles endpoint.
    func unionProfileDrafts(for client: ClientID? = nil) async throws -> UnionProfilesResponse {
        let query = client.map { [URLQueryItem(name: "clientId", value: $0.rawValue)] } ?? []
        return try await request(path: "/api/union-profile-drafts", queryItems: query)
    }

    func saveUnionProfile(_ profile: UnionProfile) async throws -> UnionProfileResponse {
        try await request(
            path: "/api/union-profiles",
            method: "POST",
            body: profile
        )
    }

    /// Persist a full-union design draft without making it executable.  The
    /// backend rejects this endpoint for Agents whose runtime is already
    /// available, so a native client cannot use it to bypass materialization
    /// or entitlement checks.
    func saveUnionProfileDraft(_ profile: UnionProfile) async throws -> UnionProfileResponse {
        try await request(
            path: "/api/union-profile-drafts",
            method: "POST",
            body: profile
        )
    }

    /// Promotion is an explicit, non-applying transition from the isolated
    /// design store into the executable union-profile store. The backend only
    /// accepts it after the target's reviewed runtime status becomes
    /// `available`.
    func promoteUnionProfileDraft(_ profile: UnionProfile) async throws -> UnionProfileResponse {
        guard profile.id.range(of: "^[a-z0-9][a-z0-9-]{0,47}$", options: .regularExpression) != nil else {
            throw NativeStudioError.backendUnavailable("设计草稿编号无效")
        }
        return try await request(
            path: "/api/union-profile-drafts/\(profile.id)/promote",
            method: "POST",
            body: DraftPromotionRequest(confirm: true)
        )
    }

    func saveProfile(_ profile: SkinProfile) async throws -> ProfileResponse {
        try await request(
            path: "/api/profiles",
            method: "POST",
            body: profile
        )
    }

    func profileTemplate(client: ClientID, skinId: String) async throws -> ProfilePreviewResponse {
        try await request(
            path: "/api/preview",
            method: "POST",
            body: ProfilePreviewRequest(clientId: client.rawValue, skinId: skinId)
        )
    }

    func freeBrand(for client: ClientID = .workbuddy) async throws -> FreeBrandResponse {
        try await request(
            path: "/api/free-brand",
            queryItems: [URLQueryItem(name: "clientId", value: client.rawValue)]
        )
    }

    func saveFreeBrand(
        displayName: String?,
        tagline: String?,
        iconImage: String?,
        composerAvatarImage: String?,
        composerAvatarMotion: String?,
        codexHomeTitle: String?,
        doubaoHomeTitle: String?,
        workbuddyHomeTitle: String?,
        for client: ClientID = .workbuddy
    ) async throws -> FreeBrandResponse {
        try await request(
            path: "/api/free-brand",
            method: "POST",
            body: FreeBrandSaveRequest(
                clientId: client.rawValue,
                displayName: displayName,
                tagline: tagline,
                iconImage: iconImage,
                composerAvatarImage: composerAvatarImage,
                composerAvatarMotion: composerAvatarMotion,
                codexHomeTitle: codexHomeTitle,
                doubaoHomeTitle: doubaoHomeTitle,
                workbuddyHomeTitle: workbuddyHomeTitle
            )
        )
    }

    func schedule() async throws -> ScheduleResponse {
        try await request(path: "/api/schedule")
    }

    func createIntent(client: ClientID, skinId: String?, operation: String) async throws -> ApplyIntentResponse {
        guard operation == "apply" || operation == "restore" else {
            throw NativeStudioError.backendUnavailable("未知的换肤操作")
        }
        return try await request(
            path: "/api/apply-intents",
            method: "POST",
            body: ApplyIntentRequest(clientId: client.rawValue, skinId: skinId, operation: operation)
        )
    }

    func confirm(intent: ApplyIntent) async throws -> OperationResponse {
        guard intent.id.range(of: "^[A-Za-z0-9_-]{32,64}$", options: .regularExpression) != nil,
              let client = ClientID(rawValue: intent.summary.clientId) else {
            throw NativeStudioError.backendUnavailable("确认操作编号无效")
        }
        return try await request(
            path: "/api/apply-intents/\(intent.id)/confirm",
            method: "POST",
            body: ConfirmIntentRequest(clientId: client.rawValue),
            // WorkBuddy/Codex can need 15 seconds to quit and 25 seconds to
            // expose a verified page; Doubao's reviewed path allows a 60
            // second renderer window.  Ten seconds turned those in-progress
            // operations into the misleading "cannot connect" result while
            // the local service was still applying the skin.
            timeoutInterval: 120
        )
    }

    func activateLicense(_ code: String, skinId: String?) async throws -> EntitlementResponse {
        try await request(
            path: "/api/license/activate",
            method: "POST",
            body: LicenseActivationRequest(code: code, skinId: skinId)
        )
    }

    func refreshLicense() async throws -> EntitlementResponse {
        try await request(path: "/api/license/refresh", method: "POST", body: EmptyRequest())
    }

    func deactivateLicense() async throws -> EntitlementResponse {
        try await request(path: "/api/license/deactivate", method: "POST", body: EmptyRequest())
    }

    func removeLicense() async throws -> EntitlementResponse {
        try await request(path: "/api/license/remove", method: "POST", body: EmptyRequest())
    }

    func updateLoginAgent(action: String) async throws -> LoginAgentResponse {
        guard action == "install" || action == "remove" else {
            throw NativeStudioError.backendUnavailable("未知的登录项操作")
        }
        return try await request(
            path: "/api/login-agent",
            method: "POST",
            body: LoginAgentRequest(action: action)
        )
    }

    func saveSchedule(_ schedule: WeeklySchedule) async throws -> ScheduleResponse {
        try await request(
            path: "/api/schedule",
            method: "POST",
            body: ScheduleSaveRequest(schedule: schedule)
        )
    }

    func decideReminder(
        _ reminder: ScheduleReminder,
        action: String,
        minutes: Int? = nil
    ) async throws -> ReminderDecisionResponse {
        guard ["apply", "skip", "snooze"].contains(action) else {
            throw NativeStudioError.backendUnavailable("未知的提醒操作")
        }
        return try await request(
            path: "/api/reminders/decision",
            method: "POST",
            body: ReminderDecisionRequest(clientId: reminder.clientId, action: action, minutes: minutes)
        )
    }

    func shutdown() async throws -> EmptyResponse {
        try await request(
            path: "/api/shutdown",
            method: "POST",
            body: EmptyRequest()
        )
    }

    private func request<Response: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        method: String = "GET",
        timeoutInterval: TimeInterval = 10
    ) async throws -> Response {
        try await request(
            path: path,
            queryItems: queryItems,
            method: method,
            bodyData: nil,
            timeoutInterval: timeoutInterval
        )
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        method: String,
        body: Body,
        timeoutInterval: TimeInterval = 10
    ) async throws -> Response {
        let data: Data
        do {
            data = try encoder.encode(body)
        } catch {
            throw NativeStudioError.backendUnavailable("无法编码本地请求")
        }
        return try await request(
            path: path,
            queryItems: queryItems,
            method: method,
            bodyData: data,
            timeoutInterval: timeoutInterval
        )
    }

    private func request<Response: Decodable>(
        path: String,
        queryItems: [URLQueryItem],
        method: String,
        bodyData: Data?,
        timeoutInterval: TimeInterval
    ) async throws -> Response {
        guard path.hasPrefix("/api/"),
              !path.contains("://"),
              !path.contains("#"),
              ["GET", "POST"].contains(method) else {
            throw NativeStudioError.backendUnavailable("本地请求路径无效")
        }

        var components = URLComponents()
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = lock.port
        components.path = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url,
              url.host == "127.0.0.1",
              url.port == lock.port else {
            throw NativeStudioError.backendUnavailable("无法构造本地服务地址")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeoutInterval
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(lock.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw NativeStudioError.backendUnavailable("无法连接本机灵妆服务")
        }

        guard let http = response as? HTTPURLResponse else {
            throw NativeStudioError.invalidResponse
        }
        guard let finalURL = http.url,
              finalURL.scheme == "http",
              finalURL.host == "127.0.0.1",
              finalURL.port == lock.port else {
            throw NativeStudioError.backendUnavailable("本地服务响应离开了受锁定的回环地址")
        }
        guard (200...299).contains(http.statusCode) else {
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw NativeStudioError.api(
                status: http.statusCode,
                message: payload?.error ?? "本地请求失败（HTTP \(http.statusCode)）",
                code: payload?.code
            )
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw NativeStudioError.invalidResponse
        }
    }
}

@MainActor
final class BackendBootstrapper {
    private var launchedProcess: Process?
    private var launchedLogHandle: FileHandle?
    private var startupTask: Task<LocalAPI, Error>?

    func ensureRunning() async throws -> LocalAPI {
        if let startupTask {
            return try await startupTask.value
        }
        let task = Task { @MainActor in
            try await self.startOrReuse()
        }
        startupTask = task
        do {
            let api = try await task.value
            startupTask = nil
            return api
        } catch {
            startupTask = nil
            throw error
        }
    }

    private func startOrReuse() async throws -> LocalAPI {
        let runtime = try packagedRuntime()
        if let api = await liveAPI(expectedRuntimeIdentity: runtime.identity) { return api }

        if let conflict = await foreignRuntimeConflict(expectedRuntimeIdentity: runtime.identity) {
            let recovered = await self.recoverForeignRuntime(conflict: conflict)
            if !recovered {
                throw NativeStudioError.foreignRuntimeConflict(conflict)
            }
            if let api = await liveAPI(expectedRuntimeIdentity: runtime.identity) { return api }
        }

        try launchBackgroundServer(runtime)

        // Runtime and installed-Agent signature verification can take longer
        // than twelve seconds on a cold start. The Node owner lock is bounded
        // separately, so keep the native handshake alive for the same window.
        for _ in 0..<150 {
            try await Task.sleep(nanoseconds: 200_000_000)
            if let api = await liveAPI(expectedRuntimeIdentity: runtime.identity) { return api }
            // A login reminder owned by an older app copy can win the owner
            // lock after the preflight check but before our child publishes a
            // session. Recover that authenticated LingGlow process in place;
            // the waiting child will claim the released lock and continue.
            if let conflict = await foreignRuntimeConflict(expectedRuntimeIdentity: runtime.identity) {
                guard await recoverForeignRuntime(conflict: conflict) else {
                    throw NativeStudioError.foreignRuntimeConflict(conflict)
                }
                continue
            }
            if let process = launchedProcess, !process.isRunning, process.terminationStatus != 0 {
                break
            }
        }
        if let diagnostic = backendDiagnostic() {
            throw NativeStudioError.backendUnavailable("内置服务启动失败：\(diagnostic)")
        }
        throw NativeStudioError.backendUnavailable("内置服务未能建立连接，请在设置中打开诊断日志。")
    }

    private func liveAPI(expectedRuntimeIdentity: String) async -> LocalAPI? {
        guard let lock = try? PrivateSessionReader.read() else { return nil }
        guard lock.runtimeIdentity == expectedRuntimeIdentity else { return nil }
        let api = LocalAPI(lock: lock)
        guard let status = try? await api.status(),
              status.studio.instanceId == lock.instanceId,
              status.studio.runtimeIdentity == expectedRuntimeIdentity else {
            return nil
        }
        return api
    }

    private func foreignRuntimeConflict(expectedRuntimeIdentity: String) async -> ForeignRuntimeConflict? {
        guard let lock = try? PrivateSessionReader.read(),
              lock.runtimeIdentity != expectedRuntimeIdentity else {
            return nil
        }
        let api = LocalAPI(lock: lock)
        guard let status = try? await api.status(), status.studio.instanceId == lock.instanceId else {
            return nil
        }
        guard status.studio.runtimeIdentity != expectedRuntimeIdentity else {
            return nil
        }
        return ForeignRuntimeConflict(
            lock: lock,
            studioRuntimeIdentity: status.studio.runtimeIdentity
        )
    }

    private func recoverForeignRuntime(conflict: ForeignRuntimeConflict) async -> Bool {
        let api = LocalAPI(lock: conflict.lock)
        let pid = conflict.lock.pid
        // Bind every wait and signal below to this exact process. The kernel can
        // hand the same PID to an unrelated process of this user while the
        // authenticated LingGlow instance is shutting down.
        let startTime = processStartTime(pid)

        // A legacy login reminder may be managed by launchd with KeepAlive.
        // Boot out only LingGlow's own per-user service after the authenticated
        // instance/runtime check above; otherwise launchd would immediately
        // respawn the old backend while the foreground app is taking over.
        suspendReminderLoginAgentForTakeover()

        do {
            _ = try await api.shutdown()
        } catch {
            // Older runtime builds may not expose /api/shutdown. The verified
            // lock and instance check above still let us recover this exact
            // LingGlow-owned process safely below.
        }

        if await waitForProcessExit(pid, startedAt: startTime, attempts: 15, intervalNanoseconds: 200_000_000) {
            try? PrivateSessionReader.removeLock()
            return true
        }

        // A successful /api/shutdown closes the listener, but a legacy Node
        // runtime can keep its event loop alive. Do not mistake that for a
        // completed shutdown: continue through bounded TERM/KILL escalation.
        if isVerifiedProcessAlive(pid, startedAt: startTime) {
            _ = Darwin.kill(pid, SIGTERM)
        }
        if await waitForProcessExit(pid, startedAt: startTime, attempts: 20, intervalNanoseconds: 150_000_000) {
            try? PrivateSessionReader.removeLock()
            return true
        }

        if isVerifiedProcessAlive(pid, startedAt: startTime) {
            _ = Darwin.kill(pid, SIGKILL)
        }
        if await waitForProcessExit(pid, startedAt: startTime, attempts: 20, intervalNanoseconds: 100_000_000) {
            try? PrivateSessionReader.removeLock()
            return true
        }
        return false
    }

    private func suspendReminderLoginAgentForTakeover() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = [
            "bootout",
            "gui/\(geteuid())/local.skin-studio.reminder",
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            // The job may already be unloaded or the service may have been
            // launched directly. The authenticated shutdown/TERM path below
            // remains the bounded fallback in both cases.
        }
    }

    private func waitForProcessExit(
        _ pid: Int32,
        startedAt startTime: UInt64?,
        attempts: Int,
        intervalNanoseconds: UInt64
    ) async -> Bool {
        for _ in 0..<attempts {
            if !isVerifiedProcessAlive(pid, startedAt: startTime) { return true }
            do {
                try await Task.sleep(nanoseconds: intervalNanoseconds)
            } catch {
                return false
            }
        }
        return !isVerifiedProcessAlive(pid, startedAt: startTime)
    }

    /// A PID that now belongs to a different process is treated as exited: the
    /// authenticated LingGlow runtime is gone and the recycled process must
    /// never receive our shutdown signals.
    private func isVerifiedProcessAlive(_ pid: Int32, startedAt startTime: UInt64?) -> Bool {
        guard isProcessAlive(pid) else { return false }
        guard let startTime, let current = processStartTime(pid) else { return true }
        return current == startTime
    }

    private func isProcessAlive(_ pid: Int32) -> Bool {
        let result = Darwin.kill(pid, 0)
        return result == 0 || errno == EPERM
    }

    private func processStartTime(_ pid: Int32) -> UInt64? {
        var request: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        var information = kinfo_proc()
        var length = MemoryLayout<kinfo_proc>.stride
        guard sysctl(&request, u_int(request.count), &information, &length, nil, 0) == 0,
              length > 0 else {
            return nil
        }
        let started = information.kp_proc.p_starttime
        return UInt64(started.tv_sec) * 1_000_000 + UInt64(started.tv_usec)
    }

    private func launchBackgroundServer(_ runtime: PackagedRuntime) throws {
        let command = runtime.root.appendingPathComponent("start.command", isDirectory: false)
        try validateStartCommand(command, inside: runtime.root)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [command.path, "--background"]
        process.currentDirectoryURL = runtime.root
        process.standardInput = FileHandle.nullDevice
        let logURL = try backendLogURL()
        // Keep the previous attempt's diagnostics; backendDiagnostic() reports
        // them to the user. Start a new file only when the log would otherwise
        // grow without bound.
        let existingLogBytes = (try? logURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if !FileManager.default.fileExists(atPath: logURL.path) || existingLogBytes > 2 * 1024 * 1024 {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        let logHandle = try FileHandle(forWritingTo: logURL)
        try logHandle.seekToEnd()
        logHandle.write(Data("\n--- LingGlow backend launch \(Date().ISO8601Format()) ---\n".utf8))
        process.standardOutput = logHandle
        process.standardError = logHandle
        // Launch the packaged backend with a tiny known-safe environment. In
        // particular, do not inherit shell startup hooks, Node preload flags,
        // dynamic-loader overrides, or proxy settings from the GUI process.
        // The packaged start command resolves its own signed runtime first.
        var environment: [String: String] = [
            "HOME": NSHomeDirectory(),
            "TMPDIR": NSTemporaryDirectory(),
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        ]
        let appSignedTeamId = Bundle.main.object(forInfoDictionaryKey: "LingGlowDeveloperTeamID") as? String
        let forceStrict = ProcessInfo.processInfo.environment["LINGGLOW_FORCE_STRICT"] == "1"
        let releasePublisherPinned = appSignedTeamId?.range(
            of: "^[A-Z0-9]{10}$",
            options: .regularExpression
        ) != nil
        // Local ad-hoc builds may opt into discovery diagnostics. A formal
        // Developer ID release always stays fail-closed for unverified Agents,
        // even when the parent desktop process has no FORCE_STRICT variable.
        environment["LINGGLOW_ALLOW_UNVERIFIED_CLIENTS"] =
            (forceStrict || releasePublisherPinned) ? "0" : "1"
        let skipBundleIdentityCheck = !forceStrict && !releasePublisherPinned &&
          (ProcessInfo.processInfo.environment["LINGGLOW_SKIP_SERVICE_IDENTITY_CHECK"] == "1" || (appSignedTeamId?.isEmpty ?? true))
        if skipBundleIdentityCheck {
            environment["LINGGLOW_SKIP_SERVICE_IDENTITY_CHECK"] = "1"
        }
        environment["LINGGLOW_PACKAGED_RUNTIME"] = "1"
        environment["LINGGLOW_RUNTIME_IDENTITY"] = runtime.identity
        process.environment = environment
        do {
            try process.run()
        } catch {
            try? logHandle.close()
            throw NativeStudioError.backendUnavailable("无法启动灵妆内置服务")
        }
        launchedLogHandle = logHandle
        launchedProcess = process
    }

    private func backendLogURL() throws -> URL {
        let logs = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/LingGlow", isDirectory: true)
        try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        return logs.appendingPathComponent("backend.log", isDirectory: false)
    }

    private func backendDiagnostic() -> String? {
        guard let logURL = try? backendLogURL(),
              let data = try? Data(contentsOf: logURL),
              let text = String(data: data.suffix(4_096), encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("--- LingGlow backend launch") }
        guard !lines.isEmpty else { return nil }
        return lines.suffix(4).joined(separator: " ").prefix(700).description
    }

    private func packagedRuntime() throws -> PackagedRuntime {
        let root = try packageRoot()
        return PackagedRuntime(root: root, identity: try PackagedRuntimeIdentity.verified(at: root))
    }

    private func packageRoot() throws -> URL {
        let bundle = Bundle.main.bundleURL.standardizedFileURL
        guard bundle.pathExtension == "app",
              Bundle.main.bundleIdentifier == "local.skin-studio.menubar" else {
            throw NativeStudioError.backendUnavailable("请从完整的灵妆.app 启动")
        }
        try validateBundleSignature(bundle)
        guard let resources = Bundle.main.resourceURL?.standardizedFileURL else {
            throw NativeStudioError.backendUnavailable("灵妆.app 缺少资源目录")
        }
        let root = resources
            .appendingPathComponent("LingGlowBackend", isDirectory: true)
            .standardizedFileURL
        guard root.deletingLastPathComponent() == resources else {
            throw NativeStudioError.backendUnavailable("灵妆内置服务路径无效")
        }

        var information = stat()
        guard lstat(root.path, &information) == 0,
              (information.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR),
              information.st_uid == geteuid() || information.st_uid == 0,
              (information.st_mode & 0o022) == 0 else {
            throw NativeStudioError.backendUnavailable("灵妆内置服务目录未通过安全检查")
        }
        return root
    }

    private func validateStartCommand(_ url: URL, inside root: URL) throws {
        guard url.standardizedFileURL.deletingLastPathComponent() == root.standardizedFileURL else {
            throw NativeStudioError.backendUnavailable("灵妆内置服务入口路径无效")
        }
        var information = stat()
        guard lstat(url.path, &information) == 0,
              (information.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              information.st_uid == geteuid() || information.st_uid == 0,
              information.st_nlink == 1,
              (information.st_mode & 0o400) != 0,
              (information.st_mode & 0o022) == 0 else {
            throw NativeStudioError.backendUnavailable("灵妆内置服务入口未通过安全检查")
        }
    }

    private func validateBundleSignature(_ bundle: URL) throws {
        let skipBundleIdentityCheck = ProcessInfo.processInfo.environment["LINGGLOW_SKIP_SERVICE_IDENTITY_CHECK"] == "1" &&
            ProcessInfo.processInfo.environment["LINGGLOW_FORCE_STRICT"] != "1"
        if skipBundleIdentityCheck {
            return
        }
        let verifier = Process()
        verifier.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        verifier.arguments = ["--verify", "--deep", "--strict", bundle.path]
        verifier.standardInput = FileHandle.nullDevice
        verifier.standardOutput = FileHandle.nullDevice
        verifier.standardError = FileHandle.nullDevice
        do {
            try verifier.run()
            verifier.waitUntilExit()
        } catch {
            throw NativeStudioError.backendUnavailable("无法校验灵妆.app 完整性")
        }
        guard verifier.terminationStatus == 0 else {
            throw NativeStudioError.backendUnavailable("灵妆.app 完整性校验失败，已拒绝启动内置服务")
        }
        if let expectedTeam = Bundle.main.object(forInfoDictionaryKey: "LingGlowDeveloperTeamID") as? String,
           !expectedTeam.isEmpty {
            guard expectedTeam.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil,
                  let actualTeam = codesignTeamIdentifier(bundle),
                  actualTeam == expectedTeam else {
                throw NativeStudioError.backendUnavailable("灵妆.app 发布者 Team ID 不匹配，已拒绝启动内置服务")
            }
        }
    }

    private func codesignTeamIdentifier(_ bundle: URL) -> String? {
        let inspector = Process()
        let diagnostics = Pipe()
        inspector.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        inspector.arguments = ["-dv", "--verbose=4", bundle.path]
        inspector.standardInput = FileHandle.nullDevice
        inspector.standardOutput = FileHandle.nullDevice
        inspector.standardError = diagnostics
        do {
            try inspector.run()
        } catch {
            return nil
        }
        // Drain the pipe before waiting: a child that fills the pipe buffer
        // would otherwise block on write while we block on exit.
        let diagnosticData = diagnostics.fileHandleForReading.readDataToEndOfFile()
        inspector.waitUntilExit()
        guard inspector.terminationStatus == 0,
              let output = String(data: diagnosticData, encoding: .utf8) else {
            return nil
        }
        return output.split(separator: "\n").first(where: { $0.hasPrefix("TeamIdentifier=") })
            .map { String($0.dropFirst("TeamIdentifier=".count)) }
    }
}

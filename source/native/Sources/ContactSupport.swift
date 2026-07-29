import AppKit
import CryptoKit
import Foundation

struct ContactQRCode: Identifiable {
    let id: String
    let title: String
    let note: String
    let image: NSImage
    let expiresAt: Date?

    var isExpired: Bool {
        expiresAt.map { $0 <= Date() } ?? false
    }
}

private struct ContactManifest: Decodable {
    let schemaVersion: Int
    let updatedAt: String
    let items: [ContactManifestItem]
}

private struct ContactManifestItem: Decodable {
    let id: String
    let titleZh: String
    let titleEn: String
    let noteZh: String
    let noteEn: String
    let imageUrl: String
    let sha256: String
    let expiresAt: String?
}

private enum ContactSupportError: Error {
    case invalidManifest
    case invalidResponse
    case invalidImage
}

@MainActor
final class ContactQRCodeStore: ObservableObject {
    @Published private(set) var codes: [ContactQRCode] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private static let manifestURL = URL(
        string: "https://raw.githubusercontent.com/AI-Scarlett/LingGlow/main/public/support/contact-qr.json"
    )!
    private static let trustedImagePrefix = "/AI-Scarlett/LingGlow/main/public/support/"
    private static let maximumManifestBytes = 32 * 1024
    private static let maximumImageBytes = 1 * 1024 * 1024
    private static let expectedIDs = Set(["group", "private"])
    private static let shaPattern = try! NSRegularExpression(pattern: "^[a-f0-9]{64}$")
    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private let cacheDirectory: URL
    private let manifestCacheURL: URL
    private var loaded = false

    init() {
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        cacheDirectory = applicationSupport
            .appendingPathComponent("Codex Skin Studio", isDirectory: true)
            .appendingPathComponent("support-contact-cache", isDirectory: true)
        manifestCacheURL = cacheDirectory.appendingPathComponent("contact-qr.json", isDirectory: false)
    }

    func loadIfNeeded() async {
        guard !loaded else { return }
        await refresh()
    }

    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let remoteData = try await download(
                Self.manifestURL,
                maximumBytes: Self.maximumManifestBytes,
                acceptedContentTypes: ["application/json", "text/plain"]
            )
            let manifest = try decodeManifest(remoteData)
            let loadedCodes = try await loadImages(for: manifest)
            try persist(remoteData, to: manifestCacheURL)
            codes = loadedCodes
            loaded = true
        } catch {
            do {
                let cachedData = try safeCachedData(at: manifestCacheURL, maximumBytes: Self.maximumManifestBytes)
                let cachedManifest = try decodeManifest(cachedData)
                codes = try await loadImages(for: cachedManifest, allowNetwork: false)
                loaded = true
                errorMessage = LingGlowL10n.string("当前显示上次成功加载的咨询二维码。")
            } catch {
                codes = []
                errorMessage = LingGlowL10n.string("暂时无法从 GitHub 读取咨询二维码，请检查网络后重试。")
            }
        }
    }

    private func decodeManifest(_ data: Data) throws -> ContactManifest {
        let decoder = JSONDecoder()
        let manifest = try decoder.decode(ContactManifest.self, from: data)
        guard manifest.schemaVersion == 1,
              Self.isoFormatter.date(from: manifest.updatedAt) != nil,
              manifest.items.count == Self.expectedIDs.count,
              Set(manifest.items.map(\.id)) == Self.expectedIDs else {
            throw ContactSupportError.invalidManifest
        }
        for item in manifest.items {
            guard item.titleZh.count <= 80,
                  item.titleEn.count <= 120,
                  item.noteZh.count <= 180,
                  item.noteEn.count <= 240,
                  validSHA256(item.sha256),
                  trustedImageURL(item.imageUrl) != nil,
                  item.expiresAt == nil || Self.isoFormatter.date(from: item.expiresAt!) != nil else {
                throw ContactSupportError.invalidManifest
            }
        }
        return manifest
    }

    private func loadImages(
        for manifest: ContactManifest,
        allowNetwork: Bool = true
    ) async throws -> [ContactQRCode] {
        var result: [ContactQRCode] = []
        for item in manifest.items.sorted(by: { $0.id < $1.id }) {
            let cacheURL = cacheDirectory.appendingPathComponent("\(item.sha256).jpg", isDirectory: false)
            let imageData: Data
            if let cached = try? safeCachedData(at: cacheURL, maximumBytes: Self.maximumImageBytes),
               digest(cached) == item.sha256 {
                imageData = cached
            } else if allowNetwork, let remoteURL = trustedImageURL(item.imageUrl) {
                let downloaded = try await download(
                    remoteURL,
                    maximumBytes: Self.maximumImageBytes,
                    acceptedContentTypes: ["image/jpeg"]
                )
                guard digest(downloaded) == item.sha256 else {
                    throw ContactSupportError.invalidImage
                }
                try persist(downloaded, to: cacheURL)
                imageData = downloaded
            } else {
                throw ContactSupportError.invalidImage
            }

            guard let image = NSImage(data: imageData),
                  image.size.width >= 128,
                  image.size.height >= 128,
                  image.size.width <= 4_096,
                  image.size.height <= 4_096 else {
                throw ContactSupportError.invalidImage
            }
            let english = LingGlowL10n.currentLanguage == "en"
            result.append(ContactQRCode(
                id: item.id,
                title: english ? item.titleEn : item.titleZh,
                note: english ? item.noteEn : item.noteZh,
                image: image,
                expiresAt: item.expiresAt.flatMap(Self.isoFormatter.date(from:))
            ))
        }
        return result
    }

    private func download(
        _ url: URL,
        maximumBytes: Int,
        acceptedContentTypes: Set<String>
    ) async throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("LingGlow/2.3.10", forHTTPHeaderField: "User-Agent")
        request.setValue(acceptedContentTypes.joined(separator: ", "), forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              data.count > 0,
              data.count <= maximumBytes else {
            throw ContactSupportError.invalidResponse
        }
        let contentType = (http.value(forHTTPHeaderField: "Content-Type") ?? "")
            .split(separator: ";", maxSplits: 1)
            .first.map(String.init)?.lowercased() ?? ""
        guard acceptedContentTypes.contains(contentType) else {
            throw ContactSupportError.invalidResponse
        }
        return data
    }

    private func trustedImageURL(_ value: String) -> URL? {
        guard let url = URL(string: value),
              url.scheme == "https",
              url.host?.lowercased() == "raw.githubusercontent.com",
              url.port == nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil,
              url.path.hasPrefix(Self.trustedImagePrefix),
              url.pathExtension.lowercased() == "jpg" else {
            return nil
        }
        return url
    }

    private func validSHA256(_ value: String) -> Bool {
        Self.shaPattern.firstMatch(
            in: value,
            range: NSRange(value.startIndex..., in: value)
        ) != nil
    }

    private func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func persist(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: cacheDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private func safeCachedData(at url: URL, maximumBytes: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [
            .isRegularFileKey,
            .isSymbolicLinkKey,
            .fileSizeKey,
        ])
        guard values.isRegularFile == true,
              values.isSymbolicLink != true,
              let size = values.fileSize,
              size > 0,
              size <= maximumBytes else {
            throw ContactSupportError.invalidResponse
        }
        return try Data(contentsOf: url, options: .mappedIfSafe)
    }
}

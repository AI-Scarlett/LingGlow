import AppKit
import ImageIO
import UniformTypeIdentifiers

enum LocalImageAssetError: LocalizedError {
    case cancelled
    case invalidFile(String)
    case unsupportedType
    case inputTooLarge
    case dimensionsTooLarge
    case animatedImage
    case transparencyRequired
    case isolatedSubjectRequired
    case decodeFailed
    case encodeFailed

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return nil
        case .invalidFile(let message):
            return LingGlowL10n.string(message)
        case .unsupportedType:
            return LingGlowL10n.string("只接受 PNG、JPG、JPEG 或 WebP 图片")
        case .inputTooLarge:
            return LingGlowL10n.string("原图不能超过 20 MB")
        case .dimensionsTooLarge:
            return LingGlowL10n.string("图片尺寸过大，请选择不超过 20,000 px / 100 MP 的图片")
        case .animatedImage:
            return LingGlowL10n.string("不接受 APNG 或动态 WebP，请选择静态图片")
        case .transparencyRequired:
            return LingGlowL10n.string("机器人图片必须包含真实透明区域；请使用透明底 PNG 或 WebP，不能使用带棋盘格背景的图片")
        case .isolatedSubjectRequired:
            return LingGlowL10n.string("机器人图片必须是透明画布上的完整独立主体，并在四周保留透明留白；不能把背景图、主视觉或圆形裁切图当作机器人")
        case .decodeFailed:
            return LingGlowL10n.string("无法安全解码这张图片")
        case .encodeFailed:
            return LingGlowL10n.string("图片压缩后仍超过 4 MB，请选择尺寸更小或内容更简单的图片")
        }
    }
}

enum LocalImageAsset {
    static let maximumInputBytes = 20 * 1024 * 1024
    static let maximumSavedBytes = 4 * 1024 * 1024
    static let maximumSavedDimension = 4096
    static let maximumInputDimension = 20_000
    static let maximumInputPixels = 100_000_000
    private static let previewCache: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>()
        cache.countLimit = 96
        cache.totalCostLimit = 96 * 1024 * 1024
        return cache
    }()
    private static let previewDecodeQueue = DispatchQueue(
        label: "local.skin-studio.preview-decode",
        qos: .userInitiated
    )

    @MainActor
    static func chooseProjectHero() throws -> String {
        try chooseImage(
            title: LingGlowL10n.string("选择 WorkBuddy 项目页图片"),
            message: LingGlowL10n.string("支持 PNG、JPG、JPEG、WebP；会在本机重新编码为静态 JPEG。"),
            maximumOutputBytes: maximumSavedBytes,
            maximumOutputDimension: maximumSavedDimension,
            preserveTransparency: false
        )
    }

    @MainActor
    static func chooseBackground() throws -> String {
        try chooseImage(
            title: LingGlowL10n.string("选择整窗背景图"),
            message: LingGlowL10n.string("背景会按目标 Agent 的能力映射铺到整个窗口；支持 PNG、JPG、JPEG、WebP。"),
            maximumOutputBytes: maximumSavedBytes,
            maximumOutputDimension: maximumSavedDimension,
            preserveTransparency: false
        )
    }

    @MainActor
    static func chooseBrandIcon() throws -> String {
        try chooseImage(
            title: LingGlowL10n.string("选择本地 Logo / 图标"),
            message: LingGlowL10n.string("支持 PNG、JPG、JPEG、WebP；会缩放到 2048 px 内，透明图标优先保存为 PNG。"),
            maximumOutputBytes: 2 * 1024 * 1024,
            maximumOutputDimension: 2048,
            preserveTransparency: true
        )
    }

    @MainActor
    static func chooseComposerAvatar() throws -> String {
        try chooseImage(
            title: LingGlowL10n.string("选择 WorkBuddy 输入框机器人"),
            message: LingGlowL10n.string("请使用透明画布上的完整机器人或角色主体，四周必须有透明留白；背景图、圆形裁切图和棋盘格底图会被拒绝。不合格时 WorkBuddy 会保留默认机器人。"),
            maximumOutputBytes: 2 * 1024 * 1024,
            maximumOutputDimension: 2048,
            preserveTransparency: true,
            requireTransparentPixels: true,
            requireIsolatedSubject: true
        )
    }

    @MainActor
    private static func chooseImage(
        title: String,
        message: String,
        maximumOutputBytes: Int,
        maximumOutputDimension: Int,
        preserveTransparency: Bool,
        requireTransparentPixels: Bool = false,
        requireIsolatedSubject: Bool = false
    ) throws -> String {
        let panel = NSOpenPanel()
        panel.title = title
        panel.prompt = LingGlowL10n.string("选择图片")
        panel.message = message
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.resolvesAliases = false
        var types: [UTType] = [.png, .jpeg]
        if let webP = UTType(filenameExtension: "webp") {
            types.append(webP)
        }
        panel.allowedContentTypes = types
        guard panel.runModal() == .OK, let url = panel.url else {
            throw LocalImageAssetError.cancelled
        }
        return try encodeImage(
            at: url,
            maximumOutputBytes: maximumOutputBytes,
            maximumOutputDimension: maximumOutputDimension,
            preserveTransparency: preserveTransparency,
            requireTransparentPixels: requireTransparentPixels,
            requireIsolatedSubject: requireIsolatedSubject
        )
    }

    static func previewImage(
        from dataURL: String?,
        cacheIdentity: String? = nil,
        maximumPixelSize: Int = 1_600
    ) -> NSImage? {
        guard let dataURL else { return nil }
        let cacheKey = cacheIdentity.map { "\($0):\(maximumPixelSize)" }
            ?? previewCacheKey(for: dataURL, maximumPixelSize: maximumPixelSize)
        if let cached = previewCache.object(forKey: cacheKey as NSString) {
            return cached
        }
        guard let comma = dataURL.firstIndex(of: ","),
              dataURL[..<comma].hasPrefix("data:image/"),
              dataURL[..<comma].hasSuffix(";base64"),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]),
                              options: []) else {
            return nil
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
              ] as CFDictionary) else {
            return nil
        }
        let image = NSImage(
            cgImage: cgImage,
            size: NSSize(width: cgImage.width, height: cgImage.height)
        )
        previewCache.setObject(
            image,
            forKey: cacheKey as NSString,
            cost: cgImage.bytesPerRow * cgImage.height
        )
        return image
    }

    static func previewImageAsync(
        from dataURL: String,
        cacheIdentity: String? = nil,
        maximumPixelSize: Int = 1_600
    ) async -> NSImage? {
        guard !Task.isCancelled else { return nil }
        return await withCheckedContinuation { continuation in
            previewDecodeQueue.async {
                continuation.resume(returning: previewImage(
                    from: dataURL,
                    cacheIdentity: cacheIdentity,
                    maximumPixelSize: maximumPixelSize
                ))
            }
        }
    }

    static func previewCacheKey(for dataURL: String, maximumPixelSize: Int) -> String {
        // This fallback is used only for small local icons. Never hash or
        // count an entire multi-megabyte Base64 string on the main actor.
        let prefix = dataURL.prefix(128)
        let suffix = dataURL.suffix(128)
        return "\(maximumPixelSize):\(prefix):\(suffix)"
    }

    static func encodeProjectHero(at url: URL) throws -> String {
        try encodeImage(
            at: url,
            maximumOutputBytes: maximumSavedBytes,
            maximumOutputDimension: maximumSavedDimension,
            preserveTransparency: false
        )
    }

    private static func encodeImage(
        at url: URL,
        maximumOutputBytes: Int,
        maximumOutputDimension: Int,
        preserveTransparency: Bool,
        requireTransparentPixels: Bool = false,
        requireIsolatedSubject: Bool = false
    ) throws -> String {
        guard url.isFileURL else {
            throw LocalImageAssetError.invalidFile("只能选择本机图片文件")
        }
        let extensionName = url.pathExtension.lowercased()
        guard ["png", "jpg", "jpeg", "webp"].contains(extensionName) else {
            throw LocalImageAssetError.unsupportedType
        }

        let values: URLResourceValues
        do {
            values = try url.resourceValues(forKeys: [
                .isRegularFileKey,
                .isSymbolicLinkKey,
                .fileSizeKey,
            ])
        } catch {
            throw LocalImageAssetError.invalidFile("无法检查所选图片")
        }
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
            throw LocalImageAssetError.invalidFile("请选择普通图片文件，不接受目录或符号链接")
        }
        guard let fileSize = values.fileSize, fileSize > 0 else {
            throw LocalImageAssetError.invalidFile("图片文件为空")
        }
        guard fileSize <= maximumInputBytes else {
            throw LocalImageAssetError.inputTooLarge
        }

        let input: Data
        do {
            input = try Data(contentsOf: url, options: [.mappedIfSafe, .uncached])
        } catch {
            throw LocalImageAssetError.invalidFile("无法读取所选图片")
        }
        guard input.count == fileSize, !input.isEmpty else {
            throw LocalImageAssetError.invalidFile("图片在读取期间发生变化")
        }
        guard let source = CGImageSourceCreateWithData(input as CFData, [
            kCGImageSourceShouldCache: false,
        ] as CFDictionary) else {
            throw LocalImageAssetError.decodeFailed
        }

        let allowedTypes = Set([
            UTType.png.identifier,
            UTType.jpeg.identifier,
            "org.webmproject.webp",
        ])
        guard let sourceType = CGImageSourceGetType(source) as String?,
              allowedTypes.contains(sourceType) else {
            throw LocalImageAssetError.unsupportedType
        }
        guard CGImageSourceGetCount(source) == 1 else {
            throw LocalImageAssetError.animatedImage
        }
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0,
              height > 0 else {
            throw LocalImageAssetError.decodeFailed
        }
        guard width <= maximumInputDimension,
              height <= maximumInputDimension,
              width.multipliedReportingOverflow(by: height).overflow == false,
              width * height <= maximumInputPixels else {
            throw LocalImageAssetError.dimensionsTooLarge
        }

        var maximumDimension = min(max(width, height), maximumOutputDimension)
        // A small source image (a 512 px icon, for example) is encoded at its
        // own size instead of being rejected by the shrink floor.
        let minimumDimension = min(640, maximumDimension)
        while maximumDimension >= minimumDimension {
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumDimension,
                kCGImageSourceShouldCacheImmediately: true,
            ] as CFDictionary) else {
                throw LocalImageAssetError.decodeFailed
            }
            if requireTransparentPixels && !hasTransparentPixels(image) {
                throw LocalImageAssetError.transparencyRequired
            }
            if requireIsolatedSubject && !meetsComposerAvatarStandard(image) {
                throw LocalImageAssetError.isolatedSubjectRequired
            }
            let representation = NSBitmapImageRep(cgImage: image)
            if preserveTransparency,
               let encoded = representation.representation(using: .png, properties: [:]),
               !encoded.isEmpty,
               encoded.count <= maximumOutputBytes {
                return "data:image/png;base64,\(encoded.base64EncodedString())"
            }
            if !preserveTransparency {
                for quality in [0.88, 0.76, 0.64, 0.52] {
                    if let encoded = representation.representation(
                        using: .jpeg,
                        properties: [.compressionFactor: quality]
                    ), !encoded.isEmpty, encoded.count <= maximumOutputBytes {
                        return "data:image/jpeg;base64,\(encoded.base64EncodedString())"
                    }
                }
            }
            maximumDimension = Int(Double(maximumDimension) * 0.82)
        }
        throw LocalImageAssetError.encodeFailed
    }

    private static func hasTransparentPixels(_ image: CGImage) -> Bool {
        alphaPixels(for: image).map { pixels in
            stride(from: 3, to: pixels.count, by: 4).contains { pixels[$0] < 250 }
        } ?? false
    }

    private static func meetsComposerAvatarStandard(_ image: CGImage) -> Bool {
        let width = image.width
        let height = image.height
        guard width > 0,
              height > 0,
              Double(width) / Double(height) >= 0.8,
              Double(width) / Double(height) <= 1.25,
              let pixels = alphaPixels(for: image) else {
            return false
        }

        let total = width * height
        let minimumPaddingX = max(2, Int(Double(width) * 0.03))
        let minimumPaddingY = max(2, Int(Double(height) * 0.03))
        var transparent = 0
        var occupied = 0
        var minimumX = width
        var minimumY = height
        var maximumX = -1
        var maximumY = -1

        for y in 0..<height {
            for x in 0..<width {
                let alpha = pixels[(y * width + x) * 4 + 3]
                if alpha <= 8 { transparent += 1 }
                if alpha >= 32 {
                    occupied += 1
                    minimumX = min(minimumX, x)
                    minimumY = min(minimumY, y)
                    maximumX = max(maximumX, x)
                    maximumY = max(maximumY, y)
                }
            }
        }

        guard occupied >= max(64, Int(Double(total) * 0.03)),
              transparent >= Int(Double(total) * 0.15),
              minimumX >= minimumPaddingX,
              minimumY >= minimumPaddingY,
              maximumX < width - minimumPaddingX,
              maximumY < height - minimumPaddingY else {
            return false
        }
        return true
    }

    private static func alphaPixels(for image: CGImage) -> [UInt8]? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else { return nil }
        let bytesPerRow = width * 4
        var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
        let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else {
                return false
            }
            context.clear(CGRect(x: 0, y: 0, width: width, height: height))
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return rendered ? pixels : nil
    }
}

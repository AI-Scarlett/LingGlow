#!/usr/bin/env swift

import AppKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    FileHandle.standardError.write(Data("用法：build_app_icon_source.swift <原始 1024 PNG> <输出 1024 PNG>\n".utf8))
    exit(2)
}

let inputURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])
guard let source = NSImage(contentsOf: inputURL) else {
    FileHandle.standardError.write(Data("无法读取应用图标原始图片：\(inputURL.path)\n".utf8))
    exit(1)
}

let canvasSize = 1024
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: canvasSize,
    pixelsHigh: canvasSize,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    FileHandle.standardError.write(Data("无法创建应用图标画布\n".utf8))
    exit(1)
}
bitmap.size = NSSize(width: canvasSize, height: canvasSize)

guard let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
    FileHandle.standardError.write(Data("无法创建应用图标绘图上下文\n".utf8))
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
graphics.imageInterpolation = .high
graphics.shouldAntialias = true

let canvas = NSRect(x: 0, y: 0, width: canvasSize, height: canvasSize)
NSColor.clear.setFill()
canvas.fill(using: .copy)

// Keep the visual footprint aligned with standard macOS Dock icons. The source
// artwork is scaled into an 84% tile, with an explicit transparent safety area.
let inset: CGFloat = 82
let tile = canvas.insetBy(dx: inset, dy: inset)
let cornerRadius = tile.width * 0.22
let mask = NSBezierPath(roundedRect: tile, xRadius: cornerRadius, yRadius: cornerRadius)
mask.addClip()
source.draw(
    in: tile,
    from: NSRect(origin: .zero, size: source.size),
    operation: .copy,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
)

graphics.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("无法编码应用图标 PNG\n".utf8))
    exit(1)
}

do {
    try png.write(to: outputURL, options: .atomic)
} catch {
    FileHandle.standardError.write(Data("无法写入应用图标：\(error.localizedDescription)\n".utf8))
    exit(1)
}

print("已生成 Dock 规范图标：\(outputURL.path)")

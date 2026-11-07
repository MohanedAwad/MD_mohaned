// Draws the app icon into an .iconset folder: `swift mac/make-icon.swift <out.iconset>`
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    let k = s / 1024

    // macOS icon grid: 824pt body inside 1024 with a soft shadow.
    let body = NSRect(x: 100 * k, y: 100 * k, width: 824 * k, height: 824 * k)
    let shape = NSBezierPath(roundedRect: body, xRadius: 185 * k, yRadius: 185 * k)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
    shadow.shadowBlurRadius = 28 * k
    shadow.shadowOffset = NSSize(width: 0, height: -10 * k)
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor.black.setFill()
    shape.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(colors: [NSColor(srgbRed: 0.145, green: 0.388, blue: 0.922, alpha: 1),
                        NSColor(srgbRed: 0.486, green: 0.227, blue: 0.929, alpha: 1)])!.draw(in: shape, angle: -50)

    // Page with folded corner.
    let page = NSRect(x: 255 * k, y: 215 * k, width: 514 * k, height: 600 * k)
    let fold = 120 * k
    let p = NSBezierPath()
    p.move(to: NSPoint(x: page.minX, y: page.minY))
    p.line(to: NSPoint(x: page.maxX, y: page.minY))
    p.line(to: NSPoint(x: page.maxX, y: page.maxY - fold))
    p.line(to: NSPoint(x: page.maxX - fold, y: page.maxY))
    p.line(to: NSPoint(x: page.minX, y: page.maxY))
    p.close()
    NSColor.white.withAlphaComponent(0.96).setFill()
    p.fill()
    let corner = NSBezierPath()
    corner.move(to: NSPoint(x: page.maxX - fold, y: page.maxY))
    corner.line(to: NSPoint(x: page.maxX - fold, y: page.maxY - fold))
    corner.line(to: NSPoint(x: page.maxX, y: page.maxY - fold))
    corner.close()
    NSColor(srgbRed: 0.80, green: 0.84, blue: 0.97, alpha: 1).setFill()
    corner.fill()

    func text(_ str: String, size: CGFloat, weight: NSFont.Weight, color: NSColor, centerY: CGFloat) {
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size * k, weight: weight), .foregroundColor: color]
        let a = NSAttributedString(string: str, attributes: attrs)
        let sz = a.size()
        a.draw(at: NSPoint(x: page.midX - sz.width / 2, y: centerY * k - sz.height / 2))
    }
    let ink = NSColor(srgbRed: 0.11, green: 0.20, blue: 0.55, alpha: 1)
    text("عربي", size: 190, weight: .heavy, color: ink, centerY: 560)
    text("M↓", size: 170, weight: .heavy, color: NSColor(srgbRed: 0.42, green: 0.25, blue: 0.85, alpha: 1), centerY: 335)

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128),
                   ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
    try draw(px).write(to: out.appendingPathComponent("icon_\(name).png"))
}

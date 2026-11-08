import Cocoa

/// Headless render check used by scripts/snapshot.sh:
/// `MDViewer --snapshot <file.md> <out.png> [--dark] [--editor] [--line N] [--command ID] [--hover CSS] [--width N] [--height N]`
/// `--hover` dispatches a synthetic mouseover on the first element matching CSS (not a real pointer).
enum Snapshot {
    /// True while rendering a snapshot: nothing is written to the user's preferences.
    static private(set) var active = false

    static func run() -> Bool {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--snapshot"), args.count > i + 2 else { return false }
        active = true
        let input = URL(fileURLWithPath: args[i + 1])
        let output = URL(fileURLWithPath: args[i + 2])
        func number(_ flag: String) -> Double? {
            args.firstIndex(of: flag).flatMap { args.count > $0 + 1 ? Double(args[$0 + 1]) : nil }
        }
        let size = NSSize(width: number("--width") ?? 1200, height: number("--height") ?? 900)
        let doc = App.shared.newWindow(prefsOverride: ["theme": args.contains("--dark") ? "dark" : "light"])
        doc.window.setContentSize(size)
        doc.window.orderFront(nil)
        doc.load(input, line: Int(number("--line") ?? 0))
        var taken = false
        doc.onRendered = {
            guard !taken else { return }
            taken = true
            if args.contains("--editor") { doc.command("toggleEditor") }
            if let c = args.firstIndex(of: "--command"), args.count > c + 1 { doc.command(args[c + 1]) }
            if let h = args.firstIndex(of: "--hover"), args.count > h + 1 {
                doc.call("document.querySelector(\(jsonLiteral(args[h + 1])))?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                doc.web.takeSnapshot(with: nil) { image, error in
                    guard let image, let tiff = image.tiffRepresentation,
                          let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
                        print("snapshot failed: \(String(describing: error))")
                        exit(1)
                    }
                    try? png.write(to: output)
                    print("wrote \(output.path)")
                    exit(0)
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { print("snapshot timed out"); exit(2) }
        return true
    }
}

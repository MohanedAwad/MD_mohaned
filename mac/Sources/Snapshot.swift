import Cocoa

/// Headless render check used by scripts/snapshot.sh:
/// `MDViewer --snapshot <file.md|untitled> <out.png> [--dark] [--editor] [--line N] [--command ID] [--hover CSS] [--zoom N] [--js CODE] [--terminal TEXT] [--width N] [--height N]`
/// `--hover` dispatches a synthetic mouseover on the first element matching CSS (not a real pointer).
/// `--zoom` sets the page zoom (as ⌘+ does); `--js` runs CODE in the page and prints its result.
/// `--terminal` opens the terminal panel, types TEXT and Return into the shell, prints what the terminal
/// shows as text, and captures the panel instead (a window that is not on screen may not paint it).
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
        if args[i + 1] == "untitled" {
            doc.setWorkspace(URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
            doc.newUntitled()
        } else {
            doc.load(input, line: Int(number("--line") ?? 0))
        }
        var taken = false
        doc.onRendered = {
            guard !taken else { return }
            taken = true
            if args.contains("--editor") { doc.command("toggleEditor") }
            if let c = args.firstIndex(of: "--command"), args.count > c + 1 { doc.command(args[c + 1]) }
            if let zoom = number("--zoom") { doc.setZoom(zoom) }
            if let j = args.firstIndex(of: "--js"), args.count > j + 1 {
                doc.web.evaluateJavaScript(args[j + 1]) { result, error in
                    print("js: \(result.map { "\($0)" } ?? error.map { "error \($0.localizedDescription)" } ?? "undefined")")
                }
            }
            if let h = args.firstIndex(of: "--hover"), args.count > h + 1 {
                doc.call("document.querySelector(\(jsonLiteral(args[h + 1])))?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))")
            }
            var typed: String?
            if let t = args.firstIndex(of: "--terminal"), args.count > t + 1 {
                typed = args[t + 1]
                doc.toggleTerminal()
                // Time for the page to load and the login shell to reach its prompt.
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { doc.typeInTerminal(args[t + 1] + "\r") }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + (typed == nil ? 1.0 : 5.5)) {
                if typed != nil {
                    doc.terminalWeb?.evaluateJavaScript("mdvTerm.text()") { text, _ in print("terminal:\n\(text as? String ?? "(nothing)")") }
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + (typed == nil ? 1.0 : 6.0)) {
                (typed == nil ? doc.web : doc.terminalWeb ?? doc.web).takeSnapshot(with: nil) { image, error in
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

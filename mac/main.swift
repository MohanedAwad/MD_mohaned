import Cocoa
import UniformTypeIdentifiers
import WebKit

let markdownExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"]
let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web").standardizedFileURL

// MARK: - Preferences

enum Prefs {
    static let defaults = UserDefaults.standard
    static var dict: [String: Any] {
        [
            "theme": defaults.string(forKey: "theme") ?? "auto",
            "outline": defaults.object(forKey: "outline") as? Bool ?? true,
            "sync": defaults.object(forKey: "sync") as? Bool ?? true,
        ]
    }
    static func set(_ key: String, _ value: Any) {
        guard ["theme", "outline", "sync"].contains(key) else { return }
        defaults.set(value, forKey: key)
    }
}

func jsonLiteral(_ value: Any) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [value])
    let s = String(data: data, encoding: .utf8)!
    return String(s.dropFirst().dropLast())
}

// MARK: - mdv:// scheme: app assets and images next to the open document

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var file: URL?
        switch url.host {
        case "app":
            let f = webRoot.appendingPathComponent(url.path).standardizedFileURL
            if f.path.hasPrefix(webRoot.path + "/") { file = f }
        case "doc":
            let f = URL(fileURLWithPath: url.path).standardizedFileURL
            // Only images: a markdown file must not be able to pull arbitrary local files into the page.
            if let t = UTType(filenameExtension: f.pathExtension), t.conforms(to: .image) { file = f }
        default:
            break
        }
        guard let file, let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// WKUserContentController retains its handler; this breaks the cycle with DocWindow.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: DocWindow?
    init(_ target: DocWindow) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handle(message.body)
    }
}

final class DropWebView: WKWebView {
    var onOpen: (([URL]) -> Void)?
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        let md = urls.filter { markdownExtensions.contains($0.pathExtension.lowercased()) }
        if !md.isEmpty { onOpen?(md); return true }
        return super.performDragOperation(sender)
    }
}

// MARK: - One window (tab) per document

final class DocWindow: NSObject, NSWindowDelegate, WKNavigationDelegate {
    let window: NSWindow
    let web: DropWebView
    private(set) var fileURL: URL?
    private var diskText = ""
    private var ready = false
    private var watcher: DispatchSourceFileSystemObject?
    var dirty = false { didSet { window.isDocumentEdited = dirty } }
    var onRendered: (() -> Void)?

    init(prefsOverride: [String: Any] = [:]) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(), forURLScheme: "mdv")
        var prefs = Prefs.dict
        prefsOverride.forEach { prefs[$0.key] = $0.value }
        config.userContentController.addUserScript(WKUserScript(
            source: "window.MDV_PREFS = \(jsonLiteral(prefs));",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        web = DropWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        super.init()

        config.userContentController.add(WeakHandler(self), name: "mdv")
        if #available(macOS 13.3, *) { web.isInspectable = true }
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.onOpen = { urls in urls.forEach { App.shared.open($0) } }

        window.contentView = web
        window.delegate = self
        window.title = "MD Viewer"
        window.tabbingMode = .preferred
        window.tabbingIdentifier = "mdv"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 420, height: 320)
        window.center()
        web.load(URLRequest(url: URL(string: "mdv://app/index.html")!))
    }

    // MARK: JS bridge

    func call(_ js: String) { web.evaluateJavaScript(js, completionHandler: nil) }
    func command(_ name: String, _ arg: Any? = nil) {
        call("mdv.command(\(jsonLiteral(name)), \(arg.map(jsonLiteral) ?? "undefined"))")
    }

    func handle(_ body: Any) {
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            sendDocument()
        case "rendered":
            onRendered?()
        case "dirty":
            dirty = msg["value"] as? Bool ?? false
        case "pref":
            if let key = msg["key"] as? String, let value = msg["value"] { Prefs.set(key, value) }
        case "copy":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(msg["text"] as? String ?? "", forType: .string)
        case "print":
            exportPDF()
        case "open":
            App.shared.openPanel()
        case "link":
            if let s = msg["href"] as? String, let url = URL(string: s) { openLink(url) }
        case "log":
            FileHandle.standardError.write("[web] \(msg["message"] ?? "")\n".data(using: .utf8)!)
        default:
            break
        }
    }

    private func openLink(_ url: URL) {
        if url.scheme == "mdv", url.host == "doc" {
            let file = URL(fileURLWithPath: url.path)
            if markdownExtensions.contains(file.pathExtension.lowercased()) {
                App.shared.open(file)
            } else {
                // Reveal, never launch: a link in an untrusted file must not run an app.
                NSWorkspace.shared.activateFileViewerSelecting([file])
            }
        } else if let scheme = url.scheme, ["http", "https", "mailto"].contains(scheme) {
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme == "mdv", url.host == "app" {
            decisionHandler(.allow)
        } else {
            if let url = action.request.url, action.navigationType == .linkActivated { openLink(url) }
            decisionHandler(.cancel)
        }
    }

    // MARK: File

    func load(_ url: URL) {
        fileURL = url
        window.title = url.lastPathComponent
        window.representedURL = url
        diskText = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        dirty = false
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        sendDocument()
        watch()
    }

    private func sendDocument() {
        guard ready, let url = fileURL else { return }
        let payload: [String: Any] = ["path": url.path, "name": url.lastPathComponent, "text": diskText]
        call("mdv.load(\(jsonLiteral(payload)))")
    }

    private func watch() {
        watcher?.cancel()
        watcher = nil
        guard let url = fileURL else { return }
        let fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.watch() }
            return
        }
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .extend, .delete, .rename, .attrib], queue: .main)
        src.setEventHandler { [weak self, unowned src] in
            guard let self else { return }
            if !src.data.isDisjoint(with: [.delete, .rename]) {
                // Editors save by replacing the file; follow the new inode.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.watch(); self.reloadFromDisk() }
                src.cancel()
            } else {
                self.reloadFromDisk()
            }
        }
        src.setCancelHandler { close(fd) }
        src.resume()
        watcher = src
    }

    private func reloadFromDisk() {
        guard let url = fileURL, let text = try? String(contentsOf: url, encoding: .utf8), text != diskText else { return }
        diskText = text
        call("mdv.diskChanged(\(jsonLiteral(text)))")
    }

    func save(then done: ((Bool) -> Void)? = nil) {
        guard let url = fileURL else { done?(false); return }
        web.evaluateJavaScript("mdv.getText()") { [weak self] result, _ in
            guard let self, let text = result as? String else { done?(false); return }
            do {
                try text.write(to: url, atomically: true, encoding: .utf8)
                self.diskText = text
                self.call("mdv.saved(\(jsonLiteral(text)))")
                self.dirty = false
                self.watch()
                done?(true)
            } catch {
                NSAlert(error: error).beginSheetModal(for: self.window)
                done?(false)
            }
        }
    }

    func exportPDF() {
        web.callAsyncJavaScript("return await mdv.preparePrint()", arguments: [:], in: nil, in: .page) { [weak self] _ in
            guard let self else { return }
            let info = NSPrintInfo.shared.copy() as! NSPrintInfo
            info.topMargin = 36; info.bottomMargin = 36; info.leftMargin = 36; info.rightMargin = 36
            info.horizontalPagination = .fit
            info.verticalPagination = .automatic
            info.jobDisposition = .save
            let name = (self.fileURL?.deletingPathExtension().lastPathComponent ?? "Document") + ".pdf"
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] =
                (self.fileURL?.deletingLastPathComponent() ?? FileManager.default.homeDirectoryForCurrentUser).appendingPathComponent(name)
            let op = self.web.printOperation(with: info)
            op.view?.frame = self.web.bounds
            op.jobTitle = name
            op.showsPrintPanel = true
            op.showsProgressPanel = true
            op.runModal(for: self.window, delegate: self, didRun: #selector(self.printDone), contextInfo: nil)
        }
    }

    @objc private func printDone(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        call("mdv.endPrint()")
    }

    // MARK: Window

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard dirty else { return true }
        let alert = NSAlert()
        alert.messageText = "Save changes to \(fileURL?.lastPathComponent ?? "this file")?"
        alert.informativeText = "Your edits will be lost if you don't save them."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Don't Save")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            switch response {
            case .alertFirstButtonReturn: self.save { ok in if ok { self.window.close() } }
            case .alertThirdButtonReturn: self.dirty = false; self.window.close()
            default: break
            }
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        watcher?.cancel()
        App.shared.closed(self)
    }
}

// MARK: - App

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    static let shared = App()
    private var docs: [DocWindow] = []
    private let recentMenu = NSMenu(title: "Open Recent")

    var current: DocWindow? {
        docs.first { $0.window == NSApp.keyWindow } ?? docs.first { $0.window == NSApp.mainWindow }
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = true
        buildMenu()
        if Snapshot.run() { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            if self.docs.isEmpty { self.newWindow().window.makeKeyAndOrderFront(nil) }
        }
    }

    func application(_ app: NSApplication, open urls: [URL]) { urls.forEach { open($0) } }
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { newWindow().window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        let unsaved = docs.filter(\.dirty)
        guard !unsaved.isEmpty else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "You have unsaved changes in \(unsaved.count) file\(unsaved.count == 1 ? "" : "s")."
        alert.informativeText = "Quit anyway and lose them?"
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Quit")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }

    @discardableResult
    func newWindow(prefsOverride: [String: Any] = [:]) -> DocWindow {
        let doc = DocWindow(prefsOverride: prefsOverride)
        if let host = current?.window ?? docs.last?.window, host.isVisible {
            host.addTabbedWindow(doc.window, ordered: .above)
        }
        docs.append(doc)
        return doc
    }

    func open(_ url: URL) {
        let url = url.standardizedFileURL
        if let existing = docs.first(where: { $0.fileURL == url }) {
            existing.window.makeKeyAndOrderFront(nil)
            return
        }
        let doc = docs.first { $0.fileURL == nil } ?? newWindow()
        doc.load(url)
        doc.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func closed(_ doc: DocWindow) { docs.removeAll { $0 === doc } }

    @objc func openPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = markdownExtensions.compactMap { UTType(filenameExtension: $0) } + [.plainText]
        if panel.runModal() == .OK { panel.urls.forEach { open($0) } }
    }

    @objc func newTab() { newWindow().window.makeKeyAndOrderFront(nil) }
    @objc func save() { current?.save() }
    @objc func exportPDF() { current?.exportPDF() }
    @objc func menuCommand(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        let parts = name.split(separator: ":", maxSplits: 1).map(String.init)
        current?.command(parts[0], parts.count > 1 ? parts[1] : nil)
    }
    @objc func zoomIn() { current.map { $0.web.pageZoom = min($0.web.pageZoom + 0.1, 3) } }
    @objc func zoomOut() { current.map { $0.web.pageZoom = max($0.web.pageZoom - 0.1, 0.5) } }
    @objc func zoomReset() { current?.web.pageZoom = 1 }
    @objc func openRecent(_ sender: NSMenuItem) { (sender.representedObject as? URL).map(open) }
    @objc func clearRecent() { NSDocumentController.shared.clearRecentDocuments(nil) }

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === recentMenu else { return }
        menu.removeAllItems()
        for url in NSDocumentController.shared.recentDocumentURLs {
            let item = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecent), keyEquivalent: "")
            item.representedObject = url
            item.toolTip = url.path
            item.target = self
            menu.addItem(item)
        }
        if menu.items.isEmpty { menu.addItem(withTitle: "No Recent Files", action: nil, keyEquivalent: "") }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Clear Menu", action: #selector(clearRecent), keyEquivalent: "").target = self
    }

    private func buildMenu() {
        let main = NSMenu()
        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let m = NSMenu(title: title)
            items.forEach { m.addItem($0) }
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = m
            main.addItem(holder)
            return m
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = target
            return i
        }
        func cmd(_ title: String, _ name: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = item(title, #selector(menuCommand), key, mods, target: self)
            i.representedObject = name
            return i
        }

        _ = submenu("MD Viewer", [
            item("About MD Viewer", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            item("Hide MD Viewer", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit MD Viewer", #selector(NSApplication.terminate(_:)), "q"),
        ])

        let recentHolder = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        recentHolder.submenu = recentMenu
        recentMenu.delegate = self
        _ = submenu("File", [
            item("New Tab", #selector(newTab), "t", target: self),
            item("Open…", #selector(openPanel), "o", target: self),
            recentHolder,
            .separator(),
            item("Close", #selector(NSWindow.performClose(_:)), "w"),
            item("Save", #selector(save), "s", target: self),
            .separator(),
            item("Export PDF…", #selector(exportPDF), "p", target: self),
        ])

        // No Undo/Redo items: the editor handles ⌘Z itself.
        _ = submenu("Edit", [
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            cmd("Copy Markdown", "copy", "c", [.command, .shift]),
            .separator(),
            cmd("Find…", "find", "f"),
            cmd("Find Next", "findNext", "g"),
            cmd("Find Previous", "findPrevious", "g", [.command, .shift]),
        ])

        let theme = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "")
        theme.submenu = NSMenu(title: "Theme")
        theme.submenu!.addItem(cmd("Auto (follow macOS)", "setTheme:auto"))
        theme.submenu!.addItem(cmd("Light", "setTheme:light"))
        theme.submenu!.addItem(cmd("Dark", "setTheme:dark"))
        _ = submenu("View", [
            cmd("Toggle Editor", "toggleEditor", "e"),
            cmd("Toggle Outline", "toggleOutline", "o", [.command, .shift]),
            cmd("Toggle Sync Scroll", "toggleSync"),
            theme,
            .separator(),
            item("Zoom In", #selector(zoomIn), "+", target: self),
            item("Zoom Out", #selector(zoomOut), "-", target: self),
            item("Actual Size", #selector(zoomReset), "0", target: self),
            .separator(),
            item("Show Tab Bar", #selector(NSWindow.toggleTabBar(_:)), ""),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])

        let windowMenu = submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("Show Previous Tab", #selector(NSWindow.selectPreviousTab(_:)), "{"),
            item("Show Next Tab", #selector(NSWindow.selectNextTab(_:)), "}"),
            item("Merge All Windows", #selector(NSWindow.mergeAllWindows(_:))),
        ])
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }
}

// MARK: - Headless check: MDViewer --snapshot <file.md> <out.png> [--dark] [--editor] [--width N] [--height N]

enum Snapshot {
    static func run() -> Bool {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--snapshot"), args.count > i + 2 else { return false }
        let input = URL(fileURLWithPath: args[i + 1])
        let output = URL(fileURLWithPath: args[i + 2])
        func num(_ flag: String, _ fallback: CGFloat) -> CGFloat {
            args.firstIndex(of: flag).flatMap { Double(args[$0 + 1]) }.map { CGFloat($0) } ?? fallback
        }
        let size = NSSize(width: num("--width", 1200), height: num("--height", 900))
        let doc = App.shared.newWindow(prefsOverride: ["theme": args.contains("--dark") ? "dark" : "light"])
        doc.window.setContentSize(size)
        doc.window.orderFront(nil)
        doc.load(input)
        var taken = false
        doc.onRendered = {
            guard !taken else { return }
            taken = true
            if args.contains("--editor") { doc.command("toggleEditor") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                doc.web.takeSnapshot(with: nil) { image, error in
                    guard let image, let tiff = image.tiffRepresentation,
                          let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
                        print("snapshot failed: \(String(describing: error))"); exit(1)
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

let app = NSApplication.shared
app.delegate = App.shared
app.setActivationPolicy(.regular)
app.run()

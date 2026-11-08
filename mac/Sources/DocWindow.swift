import Cocoa
import UniformTypeIdentifiers
import WebKit

/// One window (or tab) showing one Markdown file.
final class DocWindow: NSObject, NSWindowDelegate, WKNavigationDelegate {
    let window: NSWindow
    let web: DropWebView
    private(set) var fileURL: URL?
    private(set) var workspace: URL?
    /// ⌘T document that has never been saved.
    private(set) var isUntitled = false
    private var files: [String] = []
    private var folderWatcher: FolderWatcher?
    private var diskText = ""
    private var pendingLine = 0
    private var ready = false
    private var watcher: DispatchSourceFileSystemObject?
    var dirty = false { didSet { window.isDocumentEdited = dirty } }
    /// Opened from Zed: placed beside Zed and brought forward when Zed is.
    var besideZed = false
    var onRendered: (() -> Void)?

    init(prefsOverride: [String: Any] = [:]) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(), forURLScheme: "mdv")
        var prefs = Prefs.web
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
        window.titlebarAppearsTransparent = true
        window.tabbingMode = .preferred
        window.tabbingIdentifier = "mdv"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 420, height: 320)
        window.center()
        web.load(URLRequest(url: URL(string: "mdv://app/index.html")!))
    }

    // MARK: Bridge

    func call(_ js: String) { web.evaluateJavaScript(js, completionHandler: nil) }

    func command(_ name: String, _ arg: Any? = nil) {
        call("mdv.command(\(jsonLiteral(name)), \(arg.map(jsonLiteral) ?? "undefined"))")
    }

    func handle(_ body: Any) {
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            App.shared.installMenu(commands: msg["commands"] as? [[String: Any]] ?? [])
            sendRecents()
            sendWorkspace()
            sendDocument()
            if isUntitled { call("mdv.newDocument()") }
        case "openFile":
            if let path = msg["path"] as? String {
                App.shared.open(URL(fileURLWithPath: path), in: self, newTab: msg["newTab"] as? Bool ?? false)
            }
        case "openWorkspace":
            if let path = msg["path"] as? String {
                App.shared.openWorkspace(URL(fileURLWithPath: path), in: self, newTab: msg["newTab"] as? Bool ?? false)
            }
        case "native":
            if let id = msg["id"] as? String { App.shared.runNative(id) }
        case "rendered":
            onRendered?()
        case "dirty":
            dirty = msg["value"] as? Bool ?? false
        case "pref":
            if let key = msg["key"] as? String, let value = msg["value"] { Prefs.setFromWeb(key, value) }
        case "chrome":
            // Title bar takes the toolbar colour so the window reads as one surface.
            let dark = msg["dark"] as? Bool ?? false
            window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            if let hex = msg["color"] as? String, let color = NSColor(hex: hex) { window.backgroundColor = color }
        case "copy":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(msg["text"] as? String ?? "", forType: .string)
        case "print":
            exportPDF()
        case "open":
            App.shared.openPanel()
        case "link":
            if let s = msg["href"] as? String, let url = URL(string: s) { openLink(url, newTab: msg["newTab"] as? Bool ?? false) }
        case "log":
            FileHandle.standardError.write("[web] \(msg["message"] ?? "")\n".data(using: .utf8)!)
        default:
            break
        }
    }

    private func openLink(_ url: URL, newTab: Bool = false) {
        if url.scheme == "mdv", url.host == "doc" {
            let file = URL(fileURLWithPath: url.path)
            if markdownExtensions.contains(file.pathExtension.lowercased()) {
                App.shared.open(file, in: self, newTab: newTab)
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

    func newUntitled() {
        isUntitled = true
        fileURL = nil
        dirty = false
        window.representedURL = nil
        updateTitle()
        if ready { call("mdv.newDocument()") }
    }

    func load(_ url: URL, line: Int = 0) {
        isUntitled = false
        if let ws = workspace, url.path.hasPrefix(ws.path + "/") {} else { setWorkspace(Workspace.root(for: url)) }
        fileURL = url
        pendingLine = line
        updateTitle()
        window.representedURL = url
        Prefs.lastSession = (workspace?.path, url.path)
        diskText = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        dirty = false
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        sendDocument()
        watch()
    }

    /// Shows the project picker state for a folder with no file open yet.
    func clearFile() {
        fileURL = nil
        isUntitled = false
        watcher?.cancel()
        watcher = nil
        diskText = ""
        dirty = false
        window.representedURL = nil
        updateTitle()
        if ready { call("mdv.clear()") }
    }

    func setWorkspace(_ root: URL) {
        let root = root.standardizedFileURL
        guard workspace != root else { return }
        workspace = root
        files = []
        Workspace.noteRecent(root)
        App.shared.recentsChanged()
        folderWatcher = FolderWatcher(root) { [weak self] in self?.rescan() }
        rescan()
        updateTitle()
    }

    /// Rescans the project off the main thread; `then` runs after the new list is sent.
    func rescan(then: ((_ files: [String]) -> Void)? = nil) {
        guard let root = workspace else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let found = Workspace.scan(root)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.workspace == root else { return }
                if found != self.files { self.files = found; self.sendWorkspace() }
                then?(found)
            }
        }
    }

    func sendRecents() {
        if ready { call("mdv.setRecents(\(jsonLiteral(Workspace.recents)))") }
    }

    private func sendWorkspace() {
        guard ready, let root = workspace else { return }
        let payload: [String: Any] = ["root": root.path, "name": root.lastPathComponent, "files": files]
        call("mdv.setWorkspace(\(jsonLiteral(payload)))")
    }

    private func updateTitle() {
        window.title = fileURL?.lastPathComponent ?? (isUntitled ? "Untitled" : workspace?.lastPathComponent ?? "MD Viewer")
        window.subtitle = fileURL == nil ? "" : (workspace?.lastPathComponent ?? "")
    }

    func revealInFinder() {
        if let target = fileURL ?? workspace { NSWorkspace.shared.activateFileViewerSelecting([target]) }
    }

    func scrollTo(line: Int) {
        guard line > 0 else { return }
        command("scrollToLine", line)
    }

    private func sendDocument() {
        guard ready, let url = fileURL else { return }
        let payload: [String: Any] = ["path": url.path, "text": diskText, "line": pendingLine]
        pendingLine = 0
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
                src.cancel()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.watch(); self.reloadFromDisk() }
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
        guard let url = fileURL else {
            if isUntitled { saveAs(then: done) } else { done?(false) }
            return
        }
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

    /// First save of an untitled document: ask where, starting in the project folder.
    private func saveAs(then done: ((Bool) -> Void)?) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "md")!]
        panel.nameFieldStringValue = "Untitled.md"
        panel.directoryURL = workspace
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK, let url = panel.url else { done?(false); return }
            self.web.evaluateJavaScript("mdv.getText()") { result, _ in
                guard let text = result as? String else { done?(false); return }
                do {
                    try text.write(to: url, atomically: true, encoding: .utf8)
                    self.load(url)
                    self.rescan()
                    done?(true)
                } catch {
                    NSAlert(error: error).beginSheetModal(for: self.window)
                    done?(false)
                }
            }
        }
    }

    func exportPDF() {
        web.callAsyncJavaScript("return await mdv.preparePrint()", arguments: [:], in: nil, in: .page) { [weak self] _ in
            guard let self else { return }
            let info = NSPrintInfo.shared.copy() as! NSPrintInfo
            info.topMargin = 40; info.bottomMargin = 40; info.leftMargin = 40; info.rightMargin = 40
            info.horizontalPagination = .fit
            info.verticalPagination = .automatic
            info.jobDisposition = .save
            let name = (self.fileURL?.deletingPathExtension().lastPathComponent ?? "Document") + ".pdf"
            let folder = self.fileURL?.deletingLastPathComponent() ?? FileManager.default.homeDirectoryForCurrentUser
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = folder.appendingPathComponent(name)
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

import Cocoa
import UniformTypeIdentifiers

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate, NSMenuItemValidation {
    static let shared = App()
    private(set) var docs: [DocWindow] = []
    let recentMenu = NSMenu(title: "Open Recent")
    private var menuFromCommands = false

    var current: DocWindow? {
        docs.first { $0.window == NSApp.keyWindow } ?? docs.first { $0.window == NSApp.mainWindow } ?? docs.last
    }

    // MARK: Lifecycle

    func applicationDidFinishLaunching(_ n: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = true
        NSApp.mainMenu = MainMenu.build(self, commands: [])
        ZedCompanion.startFollowing { [weak self] in self?.docs.filter(\.besideZed).map(\.window) ?? [] }
        if Snapshot.run() { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if self.docs.isEmpty { self.restoreSession() }
        }
    }

    /// Reopens the last project and file, or an empty window.
    private func restoreSession() {
        let (workspace, file) = Prefs.lastSession
        let fm = FileManager.default
        if let file, fm.fileExists(atPath: file) {
            open(URL(fileURLWithPath: file), root: workspace.flatMap { fm.fileExists(atPath: $0) ? URL(fileURLWithPath: $0) : nil })
        } else if let workspace, fm.fileExists(atPath: workspace) {
            openWorkspace(URL(fileURLWithPath: workspace), in: nil, newTab: false)
        } else {
            newWindow().window.makeKeyAndOrderFront(nil)
        }
    }

    /// The menu bar comes from the page's command list (one source for menus, palette and shortcuts).
    func installMenu(commands: [[String: Any]]) {
        guard !menuFromCommands, !commands.isEmpty else { return }
        menuFromCommands = true
        NSApp.mainMenu = MainMenu.build(self, commands: commands)
    }

    func application(_ app: NSApplication, open urls: [URL]) {
        for url in urls {
            if url.scheme == ZedCompanion.urlScheme { openFromURLScheme(url) } else { open(url) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { restoreSession() }
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

    // MARK: Windows

    @discardableResult
    func newWindow(prefsOverride: [String: Any] = [:]) -> DocWindow {
        let doc = DocWindow(prefsOverride: prefsOverride)
        if let host = current?.window, host.isVisible {
            host.addTabbedWindow(doc.window, ordered: .above)
        }
        docs.append(doc)
        return doc
    }

    func closed(_ doc: DocWindow) { docs.removeAll { $0 === doc } }

    func recentsChanged() { docs.forEach { $0.sendRecents() } }

    private func present(_ doc: DocWindow, besideZed: Bool) {
        doc.window.tabGroup?.selectedWindow = doc.window
        if besideZed {
            doc.besideZed = true
            doc.window.orderFrontRegardless()
            // After tab selection settles; placing a tab before that is undone by the tab group.
            DispatchQueue.main.async {
                ZedCompanion.place(doc.window)
                doc.window.orderFrontRegardless()
            }
        } else {
            doc.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    // MARK: Opening

    /// Opens a file. Reuses, in order: the tab already showing it, `preferred` (unless it has unsaved
    /// edits), the Zed companion window, an empty window. `newTab` forces a new tab.
    func open(_ url: URL, line: Int = 0, besideZed: Bool = false, root: URL? = nil,
              in preferred: DocWindow? = nil, newTab: Bool = false) {
        let url = url.standardizedFileURL
        let doc: DocWindow
        if let existing = docs.first(where: { $0.fileURL == url }) {
            doc = existing
            if let root { doc.setWorkspace(root) }
            doc.scrollTo(line: line)
        } else {
            var target: DocWindow?
            if !newTab {
                if let p = preferred, !p.dirty { target = p }
                else if besideZed { target = docs.first { $0.besideZed && !$0.dirty } }
                if target == nil { target = docs.first { $0.fileURL == nil && !$0.isUntitled } }
            }
            doc = target ?? newWindow()
            if let root { doc.setWorkspace(root) }
            doc.load(url, line: line)
        }
        present(doc, besideZed: besideZed)
    }

    /// Switches a window to a project folder and opens its README when there is one.
    func openWorkspace(_ root: URL, in preferred: DocWindow?, newTab: Bool) {
        let doc = (!newTab && preferred.map { !$0.dirty } == true) ? preferred! : (newTab ? newWindow() : (docs.first { $0.fileURL == nil && !$0.isUntitled } ?? newWindow()))
        doc.setWorkspace(root)
        doc.clearFile()
        doc.rescan { files in
            if let readme = Workspace.readme(in: root, files: files), doc.fileURL == nil { doc.load(readme) }
        }
        present(doc, besideZed: false)
    }

    private func openFromURLScheme(_ url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard url.host == "open", let path = value("path"), !path.isEmpty else { return }
        ZedCompanion.log("app received \(path) line=\(value("line") ?? "-") root=\(value("root") ?? "-")")
        let root = value("root").flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
        open(URL(fileURLWithPath: path), line: Int(value("line") ?? "") ?? 0, besideZed: value("beside") == "zed", root: root)
    }

    @objc func openPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = true
        panel.message = "Choose Markdown files or a project folder"
        panel.allowedContentTypes = markdownExtensions.compactMap { UTType(filenameExtension: $0) } + [.plainText, .folder]
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir { openWorkspace(url, in: current, newTab: false) } else { open(url, in: current) }
        }
    }

    // MARK: Commands

    /// Commands marked `native` in web/src/ui/commands.js.
    func runNative(_ id: String) {
        switch id {
        case "openAny": openPanel()
        case "newTab":
            let workspace = current?.workspace
            let doc = newWindow()
            if let workspace { doc.setWorkspace(workspace) }
            doc.newUntitled()
            present(doc, besideZed: false)
        case "save": current?.save()
        case "exportPDF": current?.exportPDF()
        case "revealInFinder": current?.revealInFinder()
        case "zoomIn": current.map { $0.web.pageZoom = min($0.web.pageZoom + 0.1, 3) }
        case "zoomOut": current.map { $0.web.pageZoom = max($0.web.pageZoom - 0.1, 0.5) }
        case "zoomReset": current?.web.pageZoom = 1
        case "placeBesideZed":
            if let doc = current { doc.besideZed = true; ZedCompanion.place(doc.window) }
        case "followZed": Prefs.followZed.toggle()
        case "nextTab": current?.window.selectNextTab(nil)
        case "previousTab": current?.window.selectPreviousTab(nil)
        case "featureTour":
            if let url = Bundle.main.url(forResource: "Feature Tour", withExtension: "md") { open(url, newTab: true) }
        default: break
        }
    }

    @objc func menuCommand(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? [String: Any], let id = info["id"] as? String else { return }
        if info["native"] as? Bool == true { runNative(id) } else { current?.command(id) }
    }

    @objc func openRecent(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
        if isDir { openWorkspace(url, in: current, newTab: false) } else { open(url, in: current) }
    }

    @objc func clearRecent() { NSDocumentController.shared.clearRecentDocuments(nil) }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if let info = item.representedObject as? [String: Any], info["id"] as? String == "followZed" {
            item.state = Prefs.followZed ? .on : .off
        }
        return true
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === recentMenu else { return }
        menu.removeAllItems()
        let projects = Workspace.recents.prefix(8).map { URL(fileURLWithPath: $0) }
        let files = NSDocumentController.shared.recentDocumentURLs.prefix(10)
        for (header, urls) in [("Projects", Array(projects)), ("Files", Array(files))] where !urls.isEmpty {
            let title = NSMenuItem(title: header, action: nil, keyEquivalent: "")
            title.isEnabled = false
            menu.addItem(title)
            for url in urls {
                let item = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecent), keyEquivalent: "")
                item.representedObject = url
                item.toolTip = url.path
                item.target = self
                menu.addItem(item)
            }
        }
        if menu.items.isEmpty { menu.addItem(withTitle: "Nothing Recent", action: nil, keyEquivalent: "") }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Clear Recent Files", action: #selector(clearRecent), keyEquivalent: "").target = self
    }
}

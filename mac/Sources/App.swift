import Cocoa
import UniformTypeIdentifiers

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate, NSMenuItemValidation {
    static let shared = App()
    private(set) var docs: [DocWindow] = []
    let recentMenu = NSMenu(title: "Open Recent")

    var current: DocWindow? {
        docs.first { $0.window == NSApp.keyWindow } ?? docs.first { $0.window == NSApp.mainWindow } ?? docs.last
    }

    // MARK: Lifecycle

    func applicationDidFinishLaunching(_ n: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = true
        NSApp.mainMenu = MainMenu.build(self)
        ZedCompanion.startFollowing { [weak self] in self?.docs.filter(\.besideZed).map(\.window) ?? [] }
        if Snapshot.run() { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if self.docs.isEmpty { self.newWindow().window.makeKeyAndOrderFront(nil) }
        }
    }

    func application(_ app: NSApplication, open urls: [URL]) {
        for url in urls {
            if url.scheme == ZedCompanion.urlScheme { openFromURLScheme(url) } else { open(url) }
        }
    }

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

    // MARK: Documents

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

    /// Opens (or focuses) a file. `besideZed` places it next to Zed and leaves Zed focused.
    func open(_ url: URL, line: Int = 0, besideZed: Bool = false) {
        let url = url.standardizedFileURL
        let doc: DocWindow
        if let existing = docs.first(where: { $0.fileURL == url }) {
            doc = existing
            doc.scrollTo(line: line)
        } else {
            doc = docs.first { $0.fileURL == nil } ?? newWindow()
            doc.load(url, line: line)
        }
        doc.window.tabGroup?.selectedWindow = doc.window
        if besideZed {
            doc.besideZed = true
            ZedCompanion.place(doc.window)
            doc.window.orderFrontRegardless()
        } else {
            doc.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func openFromURLScheme(_ url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard url.host == "open", let path = value("path"), !path.isEmpty else { return }
        open(URL(fileURLWithPath: path), line: Int(value("line") ?? "") ?? 0, besideZed: value("beside") == "zed")
    }

    // MARK: Menu actions

    @objc func openPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = markdownExtensions.compactMap { UTType(filenameExtension: $0) } + [.plainText]
        if panel.runModal() == .OK { panel.urls.forEach { open($0) } }
    }

    @objc func newTab() { newWindow().window.makeKeyAndOrderFront(nil) }
    @objc func save() { current?.save() }
    @objc func exportPDF() { current?.exportPDF() }
    @objc func zoomIn() { current.map { $0.web.pageZoom = min($0.web.pageZoom + 0.1, 3) } }
    @objc func zoomOut() { current.map { $0.web.pageZoom = max($0.web.pageZoom - 0.1, 0.5) } }
    @objc func zoomReset() { current?.web.pageZoom = 1 }

    @objc func webCommand(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        let parts = name.split(separator: ":", maxSplits: 1).map(String.init)
        current?.command(parts[0], parts.count > 1 ? parts[1] : nil)
    }

    @objc func toggleFollowZed(_ sender: NSMenuItem) { Prefs.followZed.toggle() }

    @objc func placeBesideZed() {
        guard let doc = current else { return }
        doc.besideZed = true
        ZedCompanion.place(doc.window)
    }

    @objc func openFeatureTour() {
        guard let url = Bundle.main.url(forResource: "Feature Tour", withExtension: "md") else { return }
        open(url)
    }

    @objc func openRecent(_ sender: NSMenuItem) { (sender.representedObject as? URL).map { open($0) } }
    @objc func clearRecent() { NSDocumentController.shared.clearRecentDocuments(nil) }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(toggleFollowZed) { item.state = Prefs.followZed ? .on : .off }
        return true
    }

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
}

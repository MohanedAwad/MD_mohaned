import Cocoa

/// Places viewer windows beside the Zed editor and keeps them in front of it.
enum ZedCompanion {
    /// From Info.plist, so the beta build (mdviewer-beta) never receives the stable app's links.
    static let urlScheme: String = {
        let types = Bundle.main.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]]
        return (types?.first?["CFBundleURLSchemes"] as? [String])?.first ?? "md-mohaned"
    }()

    /// ~/Library/Logs/MD_mohaned/zed.log: one line per Zed request, to tell "task never ran" from "app ignored it".
    static func log(_ line: String) {
        let name = Bundle.main.infoDictionary?["CFBundleName"] as? String ?? "MD_mohaned"
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/\(name)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("zed.log")
        let entry = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
        if let h = try? FileHandle(forWritingTo: file) {
            h.seekToEndOfFile()
            h.write(entry.data(using: .utf8)!)
            try? h.close()
        } else {
            try? entry.write(to: file, atomically: true, encoding: .utf8)
        }
    }

    /// mdviewer://open?path=…&line=…&root=…&beside=zed
    static func url(file: String, row: String?, root: String?) -> URL {
        var c = URLComponents()
        c.scheme = urlScheme
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "path", value: file), URLQueryItem(name: "beside", value: "zed")]
        if let row, Int(row) != nil { c.queryItems!.append(URLQueryItem(name: "line", value: row)) }
        if let root, !root.isEmpty, !root.hasPrefix("$") { c.queryItems!.append(URLQueryItem(name: "root", value: root)) }
        return c.url!
    }

    /// Frontmost on-screen Zed editor window, in Cocoa screen coordinates.
    /// Window bounds and owner names are readable without the Screen Recording permission.
    static func zedFrame() -> NSRect? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              let primary = NSScreen.screens.first else { return nil }
        for info in list {
            guard info[kCGWindowOwnerName as String] as? String == "Zed",
                  info[kCGWindowLayer as String] as? Int == 0,
                  let dict = info[kCGWindowBounds as String] as! CFDictionary?,
                  let r = CGRect(dictionaryRepresentation: dict),
                  r.width > 300, r.height > 200 else { continue }
            return NSRect(x: r.minX, y: primary.frame.height - r.maxY, width: r.width, height: r.height)
        }
        return nil
    }

    /// Right of Zed when the screen has room, otherwise over Zed's right side.
    static func place(_ window: NSWindow) {
        guard let zed = zedFrame() else { return }
        let screen = NSScreen.screens.first { $0.frame.intersects(zed) } ?? NSScreen.main!
        let visible = screen.visibleFrame
        let room = visible.maxX - zed.maxX
        let frame: NSRect
        if room >= 520 {
            frame = NSRect(x: zed.maxX, y: zed.minY, width: min(room, 960), height: zed.height)
        } else {
            let width = max(520, (zed.width * 0.46).rounded())
            frame = NSRect(x: zed.maxX - width, y: zed.minY, width: width, height: zed.height)
        }
        window.setFrame(frame.intersection(visible), display: true, animate: window.isVisible)
    }

    private static var observer: NSObjectProtocol?

    /// When Zed comes forward, bring the companion windows with it (without stealing focus).
    static func startFollowing(_ windows: @escaping () -> [NSWindow]) {
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { note in
            guard Prefs.followZed,
                  let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  app.bundleIdentifier?.hasPrefix("dev.zed.Zed") == true else { return }
            windows().filter(\.isVisible).forEach { $0.orderFrontRegardless() }
        }
    }
}

import Cocoa
import UniformTypeIdentifiers
import WebKit

let markdownExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"]
let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web").standardizedFileURL

enum Prefs {
    private static let defaults = UserDefaults.standard
    /// Keys the web view may store. Defaults live in the web view (main.js).
    private static let webKeys: Set<String> = ["theme", "sync", "sidebar", "sidebarHidden", "vim"]

    static var web: [String: Any] {
        var out: [String: Any] = [:]
        for key in webKeys { if let v = defaults.object(forKey: key) { out[key] = v } }
        return out
    }

    static func setFromWeb(_ key: String, _ value: Any) {
        if webKeys.contains(key), !Snapshot.active { defaults.set(value, forKey: key) }
    }

    static var followZed: Bool {
        get { defaults.object(forKey: "followZed") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "followZed") }
    }

    /// Reopened when the app starts with nothing to open.
    static var lastSession: (workspace: String?, file: String?) {
        get { (defaults.string(forKey: "lastWorkspace"), defaults.string(forKey: "lastFile")) }
        set {
            guard !Snapshot.active else { return }
            defaults.set(newValue.workspace, forKey: "lastWorkspace")
            defaults.set(newValue.file, forKey: "lastFile")
        }
    }
}

/// A Swift value as a JavaScript literal (JSON is valid JS).
func jsonLiteral(_ value: Any) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [value])
    let s = String(data: data, encoding: .utf8)!
    return String(s.dropFirst().dropLast())
}

/// mdv://app/… serves the bundled UI; mdv://doc/<absolute path> serves images next to the document.
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
            // Images only: a Markdown file must not be able to pull arbitrary local files into the page.
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

/// WKUserContentController retains its handler; this breaks the cycle with DocWindow.
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

extension NSColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}

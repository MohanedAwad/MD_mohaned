import Cocoa
import WebKit

/// The terminal panel under a document (⌃`): the user's login shell on a pseudo-terminal,
/// drawn by xterm.js in a web view of its own. The shell bridge (`term`) exists only on that
/// web view, so the page that renders Markdown has no way to reach it.
final class TerminalPane: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let web: WKWebView
    /// The shell ended (`exit`, ⌃D): the owner removes the panel.
    var onExit: (() -> Void)?
    /// ⌃` pressed inside the terminal.
    var onToggle: (() -> Void)?
    private static let page = URL(string: "mdv://app/terminal.html")!
    private let directory: URL
    private var dark: Bool
    private var master: Int32 = -1
    private var pid: pid_t = 0
    private var reader: DispatchSourceRead?
    private var exitWatch: DispatchSourceProcess?
    private var ready = false
    /// Shell output that arrived before the page finished loading.
    private var pending = Data()

    init(directory: URL, dark: Bool) {
        self.directory = directory
        self.dark = dark
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(), forURLScheme: "mdv")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 280), configuration: config)
        super.init()
        config.userContentController.add(WeakTerminalHandler(self), name: "term")
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.load(URLRequest(url: Self.page))
    }

    deinit { close() }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url == Self.page ? .allow : .cancel)
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            setDark(dark)
            if pid == 0 { start(cols: msg["cols"] as? Int ?? 80, rows: msg["rows"] as? Int ?? 24) }
            flush()
            focus()
        case "input":
            if let text = msg["data"] as? String { send(text) }
        case "toggle":
            onToggle?()
        case "resize":
            resize(cols: msg["cols"] as? Int ?? 80, rows: msg["rows"] as? Int ?? 24)
        default:
            break
        }
    }

    func setDark(_ dark: Bool) {
        self.dark = dark
        if ready { web.evaluateJavaScript("mdvTerm.setTheme(\(dark))", completionHandler: nil) }
    }

    func focus() {
        web.window?.makeFirstResponder(web)
        if ready { web.evaluateJavaScript("mdvTerm.focus()", completionHandler: nil) }
    }

    /// Types `text` into the shell, as the keyboard would.
    func send(_ text: String) {
        guard master >= 0 else { return }
        var bytes = Array(text.utf8)
        while !bytes.isEmpty {
            let n = write(master, bytes, bytes.count)
            if n <= 0 { if errno == EINTR || errno == EAGAIN { continue }; break }
            bytes.removeFirst(n)
        }
    }

    func close() {
        reader?.cancel()
        reader = nil
        exitWatch?.cancel()
        exitWatch = nil
        if pid > 0 {
            let child = pid
            pid = 0
            kill(child, SIGHUP)
            DispatchQueue.global(qos: .utility).async { var status: Int32 = 0; waitpid(child, &status, 0) }
        }
    }

    // MARK: Shell

    private func start(cols: Int, rows: Int) {
        let shell = ProcessInfo.processInfo.environment["SHELL"]
            ?? String(cString: getpwuid(getuid()).pointee.pw_shell)
        var env = ProcessInfo.processInfo.environment
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["TERM_PROGRAM"] = "MDViewer"
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }

        // Everything the child needs is prepared as C data before the fork: between fork and exec
        // only chdir and execve run, since nothing else is safe in a forked Swift process.
        // A leading "-" in argv[0] makes it a login shell, so the user's PATH and profile load.
        let path = strdup(shell)
        let argv: [UnsafeMutablePointer<CChar>?] = [strdup("-" + (shell as NSString).lastPathComponent), nil]
        let envp: [UnsafeMutablePointer<CChar>?] = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
        let dir = strdup(directory.path)
        var size = winsize(ws_row: UInt16(max(rows, 2)), ws_col: UInt16(max(cols, 2)), ws_xpixel: 0, ws_ypixel: 0)

        let child = forkpty(&master, nil, nil, &size)
        if child == 0 {
            _ = chdir(dir)
            execve(path, argv, envp)
            _exit(127)
        }
        ([path, dir] + argv + envp).forEach { free($0) }
        guard child > 0 else { master = -1; return }
        pid = child
        // Multi-byte characters (Arabic) erase as one character on the kernel's own line editing.
        var mode = termios()
        if tcgetattr(master, &mode) == 0 { mode.c_iflag |= tcflag_t(IUTF8); tcsetattr(master, TCSANOW, &mode) }

        let fd = master
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        source.setEventHandler { [weak self] in
            var buffer = [UInt8](repeating: 0, count: 65536)
            let n = read(fd, &buffer, buffer.count)
            guard n > 0, let self else { return }
            self.pending.append(contentsOf: buffer[0..<n])
            self.flush()
        }
        source.setCancelHandler { Darwin.close(fd) }
        source.resume()
        reader = source

        let watch = DispatchSource.makeProcessSource(identifier: child, eventMask: .exit, queue: .main)
        watch.setEventHandler { [weak self] in
            var status: Int32 = 0
            waitpid(child, &status, 0)
            guard let self else { return }
            self.pid = 0
            self.master = -1
            self.close()
            self.onExit?()
        }
        watch.resume()
        exitWatch = watch
    }

    private func resize(cols: Int, rows: Int) {
        guard master >= 0 else { return }
        var size = winsize(ws_row: UInt16(max(rows, 2)), ws_col: UInt16(max(cols, 2)), ws_xpixel: 0, ws_ypixel: 0)
        _ = ioctl(master, TIOCSWINSZ, &size)
    }

    /// Sends buffered shell output to the page (raw bytes as base64; xterm decodes the UTF-8).
    private func flush() {
        guard ready, !pending.isEmpty else { return }
        let chunk = pending.base64EncodedString()
        pending.removeAll(keepingCapacity: true)
        web.evaluateJavaScript("mdvTerm.write('\(chunk)')", completionHandler: nil)
    }
}

/// WKUserContentController retains its handler; this breaks the cycle with TerminalPane.
final class WeakTerminalHandler: NSObject, WKScriptMessageHandler {
    weak var target: TerminalPane?
    init(_ target: TerminalPane) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(c, didReceive: message)
    }
}

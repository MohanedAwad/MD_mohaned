import Cocoa

// Zed task entry: `MDViewer --zed <file> [row] [project root]` hands the file to the running app (or starts it)
// in the background, then exits. Plain argv, so Zed's task file needs no shell quoting.
let arguments = CommandLine.arguments
if arguments.count >= 3, arguments[1] == "--zed" {
    let url = ZedCompanion.url(file: arguments[2], row: arguments.count > 3 ? arguments[3] : nil,
                               root: arguments.count > 4 ? arguments[4] : nil)
    let open = Process()
    open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    open.arguments = ["-g", url.absoluteString]
    do {
        try open.run()
        open.waitUntilExit()
    } catch {
        ZedCompanion.log("--zed failed to run open: \(error)")
        exit(1)
    }
    ZedCompanion.log("--zed \(arguments[2]) row=\(arguments.count > 3 ? arguments[3] : "-") open-status=\(open.terminationStatus)")
    exit(open.terminationStatus)
}

let app = NSApplication.shared
app.delegate = App.shared
app.setActivationPolicy(.regular)
app.run()

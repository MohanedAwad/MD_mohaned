import Cocoa

// Zed task helper: print the companion URL and exit without starting the UI.
let arguments = CommandLine.arguments
if arguments.count >= 3, arguments[1] == "--zed-url" {
    print(ZedCompanion.url(file: arguments[2], row: arguments.count > 3 ? arguments[3] : nil).absoluteString)
    exit(0)
}

let app = NSApplication.shared
app.delegate = App.shared
app.setActivationPolicy(.regular)
app.run()

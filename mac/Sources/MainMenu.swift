import Cocoa

/// Menu bar. App-level and text-editing items are fixed; everything else comes from the
/// command list in web/src/ui/commands.js, so shortcuts are defined in exactly one place.
enum MainMenu {
    private static let groupOrder = ["File", "Edit", "View", "Go", "Zed", "Window", "Help"]

    /// "cmd+shift+p" → ("p", [.command, .shift])
    static func keyEquivalent(_ spec: String) -> (String, NSEvent.ModifierFlags)? {
        guard !spec.isEmpty else { return nil }
        var mods: NSEvent.ModifierFlags = []
        var key = ""
        for part in spec.split(separator: "+").map(String.init) {
            switch part {
            case "cmd": mods.insert(.command)
            case "shift": mods.insert(.shift)
            case "alt": mods.insert(.option)
            case "ctrl": mods.insert(.control)
            case "tab": key = "\t"
            case "plus": key = "+"
            default: key = part
            }
        }
        return key.isEmpty ? nil : (key, mods)
    }

    static func build(_ app: App, commands: [[String: Any]]) -> NSMenu {
        let main = NSMenu()
        var menus: [String: NSMenu] = [:]

        func menu(_ title: String) -> NSMenu {
            if let m = menus[title] { return m }
            let m = NSMenu(title: title)
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = m
            main.addItem(holder)
            menus[title] = m
            return m
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            return i
        }

        let appMenu = menu("MD_mohaned")
        [item("About MD_mohaned", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
         .separator(),
         item("Hide MD_mohaned", #selector(NSApplication.hide(_:)), "h"),
         item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
         item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
         .separator(),
         item("Quit MD_mohaned", #selector(NSApplication.terminate(_:)), "q")].forEach(appMenu.addItem)

        groupOrder.forEach { _ = menu($0) }

        for c in commands {
            guard let id = c["id"] as? String, let title = c["title"] as? String, let group = c["group"] as? String else { continue }
            let i = NSMenuItem(title: title, action: #selector(App.menuCommand), keyEquivalent: "")
            if let (key, mods) = keyEquivalent(c["keys"] as? String ?? "") {
                i.keyEquivalent = key
                i.keyEquivalentModifierMask = mods
            }
            i.target = app
            i.representedObject = ["id": id, "native": c["native"] as? Bool ?? false]
            menu(group).addItem(i)
            if id == "openAny" {
                let recent = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
                recent.submenu = app.recentMenu
                app.recentMenu.delegate = app
                menu(group).addItem(recent)
            }
        }

        // Standard text editing (first responder). No Undo/Redo items: the editor handles ⌘Z itself.
        let edit = menu("Edit")
        [item("Cut", #selector(NSText.cut(_:)), "x"),
         item("Copy", #selector(NSText.copy(_:)), "c"),
         item("Paste", #selector(NSText.paste(_:)), "v"),
         item("Select All", #selector(NSText.selectAll(_:)), "a"),
         .separator()].reversed().forEach { edit.insertItem($0, at: 0) }

        let file = menu("File")
        file.addItem(.separator())
        file.addItem(item("Close", #selector(NSWindow.performClose(_:)), "w"))

        let window = menu("Window")
        [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
         item("Zoom", #selector(NSWindow.performZoom(_:))),
         item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
         item("Show Tab Bar", #selector(NSWindow.toggleTabBar(_:))),
         item("Merge All Windows", #selector(NSWindow.mergeAllWindows(_:))),
         .separator()].reversed().forEach { window.insertItem($0, at: 0) }
        NSApp.windowsMenu = window
        NSApp.helpMenu = menu("Help")

        return main
    }
}

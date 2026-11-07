import Cocoa

enum MainMenu {
    static func build(_ app: App) -> NSMenu {
        let main = NSMenu()

        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            items.forEach { menu.addItem($0) }
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = menu
            main.addItem(holder)
            return menu
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = target
            return i
        }
        func web(_ title: String, _ command: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = item(title, #selector(App.webCommand), key, mods, target: app)
            i.representedObject = command
            return i
        }

        _ = submenu("MD Viewer", [
            item("About MD Viewer", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Hide MD Viewer", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit MD Viewer", #selector(NSApplication.terminate(_:)), "q"),
        ])

        let recent = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        recent.submenu = app.recentMenu
        app.recentMenu.delegate = app
        _ = submenu("File", [
            item("New Tab", #selector(App.newTab), "t", target: app),
            item("Open…", #selector(App.openPanel), "o", target: app),
            recent,
            .separator(),
            item("Close", #selector(NSWindow.performClose(_:)), "w"),
            item("Save", #selector(App.save), "s", target: app),
            .separator(),
            item("Export PDF…", #selector(App.exportPDF), "p", target: app),
        ])

        // No Undo/Redo items: the editor handles ⌘Z itself.
        _ = submenu("Edit", [
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            web("Copy Markdown", "copy", "c", [.command, .shift]),
            .separator(),
            web("Find…", "find", "f"),
            web("Find Next", "findNext", "g"),
            web("Find Previous", "findPrevious", "g", [.command, .shift]),
        ])

        let theme = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "")
        theme.submenu = NSMenu(title: "Theme")
        theme.submenu!.addItem(web("Auto (follow macOS)", "setTheme:auto"))
        theme.submenu!.addItem(web("Light", "setTheme:light"))
        theme.submenu!.addItem(web("Dark", "setTheme:dark"))
        _ = submenu("View", [
            web("Toggle Editor", "toggleEditor", "e"),
            web("Toggle Outline", "toggleOutline", "o", [.command, .shift]),
            web("Toggle Sync Scroll", "toggleSync"),
            theme,
            .separator(),
            item("Zoom In", #selector(App.zoomIn), "+", target: app),
            item("Zoom Out", #selector(App.zoomOut), "-", target: app),
            item("Actual Size", #selector(App.zoomReset), "0", target: app),
            .separator(),
            item("Show Tab Bar", #selector(NSWindow.toggleTabBar(_:))),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])

        _ = submenu("Zed", [
            item("Place Beside Zed", #selector(App.placeBesideZed), "z", [.command, .option], target: app),
            item("Come Forward With Zed", #selector(App.toggleFollowZed(_:)), target: app),
        ])

        let window = submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("Show Previous Tab", #selector(NSWindow.selectPreviousTab(_:)), "{"),
            item("Show Next Tab", #selector(NSWindow.selectNextTab(_:)), "}"),
            item("Merge All Windows", #selector(NSWindow.mergeAllWindows(_:))),
        ])
        NSApp.windowsMenu = window

        let help = submenu("Help", [item("Feature Tour", #selector(App.openFeatureTour), target: app)])
        NSApp.helpMenu = help
        return main
    }
}

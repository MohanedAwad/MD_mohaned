import Cocoa
import CoreServices

/// A project folder: its Markdown files, a live watch on it, and the recent-projects list.
enum Workspace {
    private static let skippedFolders: Set<String> = [
        "node_modules", "vendor", "build", "dist", "out", "target", "Pods", "DerivedData",
        "__pycache__", "venv", "coverage", "storage", "bower_components",
    ]
    static let fileLimit = 5000

    /// Folder to treat as the project for a file opened on its own: the nearest Git root, else its folder.
    static func root(for file: URL) -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path
        var dir = file.deletingLastPathComponent().standardizedFileURL
        while dir.path.count > 1, dir.path != home {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent(".git").path) { return dir }
            dir = dir.deletingLastPathComponent()
        }
        return file.deletingLastPathComponent().standardizedFileURL
    }

    /// Markdown files under `root`, as sorted relative paths. Hidden and build folders are skipped.
    static func scan(_ root: URL) -> [String] {
        let rootPath = root.standardizedFileURL.path
        guard let walker = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var files: [String] = []
        for case let url as URL in walker {
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir {
                if skippedFolders.contains(url.lastPathComponent) { walker.skipDescendants() }
                continue
            }
            guard markdownExtensions.contains(url.pathExtension.lowercased()) else { continue }
            let path = url.standardizedFileURL.path
            guard path.hasPrefix(rootPath + "/") else { continue }
            files.append(String(path.dropFirst(rootPath.count + 1)))
            if files.count >= fileLimit { break }
        }
        return files.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    /// README.md (any case) at the top of the project, if any.
    static func readme(in root: URL, files: [String]) -> URL? {
        files.first { !$0.contains("/") && $0.lowercased() == "readme.md" }.map { root.appendingPathComponent($0) }
    }

    // MARK: Recent projects

    private static let recentsKey = "recentWorkspaces"

    static var recents: [String] {
        (UserDefaults.standard.stringArray(forKey: recentsKey) ?? []).filter { FileManager.default.fileExists(atPath: $0) }
    }

    static func noteRecent(_ root: URL) {
        guard !Snapshot.active else { return }
        var list = recents.filter { $0 != root.path }
        list.insert(root.path, at: 0)
        UserDefaults.standard.set(Array(list.prefix(15)), forKey: recentsKey)
    }
}

/// Calls `onChange` (debounced) when anything under a folder is added, removed or renamed.
final class FolderWatcher {
    private var stream: FSEventStreamRef?
    private let onChange: () -> Void
    private var pending: DispatchWorkItem?

    init(_ folder: URL, onChange: @escaping () -> Void) {
        self.onChange = onChange
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                           retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            Unmanaged<FolderWatcher>.fromOpaque(info).takeUnretainedValue().changed()
        }
        stream = FSEventStreamCreate(nil, callback, &context, [folder.path] as CFArray,
                                     FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.4,
                                     FSEventStreamCreateFlags(kFSEventStreamCreateFlagNone))
        if let stream {
            FSEventStreamSetDispatchQueue(stream, .main)
            FSEventStreamStart(stream)
        }
    }

    private func changed() {
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.onChange() }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    deinit {
        pending?.cancel()
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }
    }
}

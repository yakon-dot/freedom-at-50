import Foundation
import FilesystemPlugin
import LocalNotificationsPlugin
import SharePlugin

public let isCapacitorApp = true

/**
 Capacitor registers SPM plugins through `packageClassList` + `NSClassFromString`.
 CapApp-SPM depends on plugin products, but without a live Swift reference the linker
 can dead-strip those classes. Then JS sees `isPluginAvailable(...) === false`
 even though the package appears in Xcode.

 Keep retained references so Filesystem, LocalNotifications, and Share stay linked.
 */
enum FreedomCapAppSPMPluginAnchor {
  static let linkedPluginClasses: [AnyClass] = [
    FilesystemPlugin.self,
    LocalNotificationsPlugin.self,
    SharePlugin.self
  ]
}

private let freedomRetainLinkedCapacitorPlugins: Int = {
  FreedomCapAppSPMPluginAnchor.linkedPluginClasses.count
}()

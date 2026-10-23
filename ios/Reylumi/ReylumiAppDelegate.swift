import UIKit

@MainActor
final class ReylumiAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        if !ReylumiExecutionEnvironment.isXCTestHost { ReylumiBackgroundSync.shared.registerScheduler() }
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        if !ReylumiExecutionEnvironment.isXCTestHost { ReylumiBackgroundSync.shared.schedule() }
    }
}

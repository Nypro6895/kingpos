import SwiftUI

@main
struct ReylumiApp: App {
    var body: some Scene {
        WindowGroup {
            ReylumiView().ignoresSafeArea(.keyboard)
        }
    }
}

struct ReylumiView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ReylumiViewController {
        ReylumiViewController()
    }
    func updateUIViewController(_ controller: ReylumiViewController, context: Context) {}
}

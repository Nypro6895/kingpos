import UIKit

/// Bundled UI is available before the first network response or web stylesheet.
final class ReylumiLaunchView: UIView {
    private let mark = ReylumiOrbitView()
    private let heading = UILabel()
    private let detail = UILabel()
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private(set) var isLoading = false
    var onRetry: (() -> Void)?
    private var slowLoad: DispatchWorkItem?
    private var vietnamese: Bool { Locale.preferredLanguages.first?.hasPrefix("vi") == true }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        accessibilityIdentifier = "reylumi.launch"
        heading.font = .preferredFont(forTextStyle: .title2)
        heading.textColor = UIColor(red: 0.16, green: 0.14, blue: 0.15, alpha: 1)
        detail.font = .preferredFont(forTextStyle: .subheadline)
        status.font = .preferredFont(forTextStyle: .footnote)
        for label in [heading, detail, status] {
            label.textAlignment = .center
            label.numberOfLines = 0
            label.adjustsFontForContentSizeCategory = true
        }
        detail.textColor = .secondaryLabel
        status.textColor = .secondaryLabel
        retry.configuration = .filled()
        retry.configuration?.baseBackgroundColor = ReylumiOrbitView.teal
        retry.configuration?.cornerStyle = .capsule
        retry.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 24, bottom: 12, trailing: 24)
        retry.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [mark, heading, detail, status, retry])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(28, after: mark)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            mark.widthAnchor.constraint(equalToConstant: 112),
            mark.heightAnchor.constraint(equalToConstant: 112),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24),
            detail.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -48),
            status.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -48)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func showLoading() {
        slowLoad?.cancel()
        layer.removeAllAnimations()
        alpha = 1
        isHidden = false
        isLoading = true
        retry.isHidden = true
        heading.text = vietnamese ? "Chào bạn," : "Welcome,"
        detail.text = vietnamese ? "Một chút cảm hứng cho hôm nay." : "A little inspiration for your day."
        status.text = vietnamese ? "Đang kết nối…" : "Connecting…"
        mark.setLoading(true)
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.isLoading else { return }
            self.status.text = self.vietnamese ? "Kết nối lâu hơn bình thường. Bạn có thể thử lại." : "Taking a little longer. You can try again."
            self.retry.setTitle(self.vietnamese ? "Thử lại" : "Try again", for: .normal)
            self.retry.isHidden = false
        }
        slowLoad = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    func showError() {
        slowLoad?.cancel()
        layer.removeAllAnimations()
        alpha = 1
        isHidden = false
        isLoading = false
        mark.setLoading(false)
        heading.text = vietnamese ? "Hãy kết nối lại nhé" : "Let's reconnect"
        detail.text = vietnamese ? "Kiểm tra Wi-Fi hoặc dữ liệu di động rồi thử lại." : "Check your Wi-Fi or mobile data, then try again."
        status.text = nil
        retry.setTitle(vietnamese ? "Thử lại" : "Try again", for: .normal)
        retry.isHidden = false
        UIAccessibility.post(notification: .layoutChanged, argument: heading)
    }

    func finishLoading() {
        slowLoad?.cancel()
        isLoading = false
        mark.setLoading(false)
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2, animations: { self.alpha = 0 }) { [weak self] _ in
            // A new navigation may have started during the fade.
            guard let self, !self.isLoading, self.alpha == 0 else { return }
            self.isHidden = true
        }
    }

    @objc private func retryTapped() { onRetry?() }
}

final class ReylumiOrbitView: UIView {
    static let teal = UIColor(red: 29 / 255.0, green: 128 / 255.0, blue: 124 / 255.0, alpha: 1)
    private let orbit = UIView(frame: CGRect(x: 0, y: 0, width: 112, height: 112))
    private let track = CAShapeLayer()
    private var loading = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = false
        let image = UIImageView(image: UIImage(named: "LoadingLogo"))
        image.contentMode = .scaleAspectFit
        image.frame = CGRect(x: 26, y: 26, width: 60, height: 60)
        addSubview(image)
        track.path = UIBezierPath(ovalIn: CGRect(x: 5, y: 5, width: 102, height: 102)).cgPath
        track.fillColor = UIColor.clear.cgColor
        track.strokeColor = Self.teal.withAlphaComponent(0.12).cgColor
        track.lineWidth = 1
        layer.addSublayer(track)
        addSubview(orbit)
        // Short, overlapping segments form a fading comet trail, without a timer.
        for index in 0..<20 {
            let segment = CAShapeLayer()
            let start = -CGFloat.pi / 2 - 1.75 + CGFloat(index) * 1.75 / 20
            segment.path = UIBezierPath(arcCenter: CGPoint(x: 56, y: 56), radius: 51, startAngle: start, endAngle: start + 0.10, clockwise: true).cgPath
            segment.strokeColor = Self.teal.withAlphaComponent(CGFloat(index + 1) / 20).cgColor
            segment.fillColor = UIColor.clear.cgColor
            segment.lineWidth = 2
            orbit.layer.addSublayer(segment)
        }
        let star = UIImageView(image: UIImage(systemName: "sparkle"))
        star.tintColor = Self.teal
        star.frame = CGRect(x: 47, y: -4, width: 18, height: 18)
        orbit.addSubview(star)
        NotificationCenter.default.addObserver(self, selector: #selector(updateMotion), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(updateMotion), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(pauseMotion), name: UIApplication.willResignActiveNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { NotificationCenter.default.removeObserver(self) }
    override func didMoveToWindow() { super.didMoveToWindow(); updateMotion() }

    func setLoading(_ value: Bool) {
        loading = value
        orbit.isHidden = !value
        track.isHidden = !value
        updateMotion()
    }

    @objc private func pauseMotion() { orbit.layer.removeAnimation(forKey: "reylumi.orbit") }
    @objc private func updateMotion() {
        pauseMotion()
        guard loading, window != nil, !UIAccessibility.isReduceMotionEnabled,
              UIApplication.shared.applicationState == .active else { return }
        let animation = CABasicAnimation(keyPath: "transform.rotation.z")
        animation.fromValue = 0
        animation.toValue = CGFloat.pi * 2
        animation.duration = 2.4
        animation.repeatCount = .infinity
        animation.timingFunction = CAMediaTimingFunction(name: .linear)
        orbit.layer.add(animation, forKey: "reylumi.orbit")
    }
}

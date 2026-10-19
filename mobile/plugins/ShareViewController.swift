//
// Mneme share extension.
//
// Installed over expo-share-intent's generated controller by
// plugins/withShareExtensionCapture.js (which fills in __APP_GROUP__ and
// __API_URL__ at prebuild time). Sharing IS the capture: the extension reads
// the session token from the app-group keychain, posts the item to the
// backend, shows a small confirmation card and dismisses. It deliberately
// never opens the host app.
//
import MobileCoreServices
import Security
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
  private let appGroup = "__APP_GROUP__"
  private let apiBaseUrl = "__API_URL__"
  // Must match lib/storage.ts (expo-secure-store: service "app:no-auth",
  // account == generic == the key, utf8 value).
  private let tokenKey = "mneme_auth_token"
  private let keychainService = "app:no-auth"

  private enum Payload {
    case link(String)
    case text(String)
    case file(Data, mimeType: String, isPdf: Bool)
  }

  private struct SaveResult {
    let title: String
    let limitMessage: String?
  }

  private struct RequestError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  // MARK: UI

  private let card = UIView()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let statusLabel = UILabel()
  private let detailLabel = UILabel()
  private var cardBottom: NSLayoutConstraint?
  private var started = false
  private var finished = false

  private let paper = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.10, green: 0.09, blue: 0.08, alpha: 1) : UIColor(red: 0.953, green: 0.937, blue: 0.902, alpha: 1) }
  private let ink = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.93, green: 0.91, blue: 0.87, alpha: 1) : UIColor(red: 0.145, green: 0.129, blue: 0.098, alpha: 1) }
  private let muted = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.62, alpha: 1) : UIColor(white: 0.42, alpha: 1) }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    view.isOpaque = false
    buildCard()
    view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap)))
  }

  // Work starts once the presentation has settled: completing the request
  // while the host is still animating the sheet in leaves the host stuck
  // behind a dimming layer (expo-share-intent #217/#231).
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    showCard()
    start()
  }

  private func buildCard() {
    card.translatesAutoresizingMaskIntoConstraints = false
    card.backgroundColor = paper
    card.layer.cornerRadius = 20
    card.layer.cornerCurve = .continuous
    card.layer.shadowColor = UIColor.black.cgColor
    card.layer.shadowOpacity = 0.18
    card.layer.shadowRadius = 24
    card.layer.shadowOffset = CGSize(width: 0, height: 8)
    view.addSubview(card)

    let brand = UILabel()
    brand.text = "MNEME"
    brand.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
    brand.textColor = muted
    brand.attributedText = NSAttributedString(string: "MNEME", attributes: [.kern: 2.2, .font: brand.font as Any, .foregroundColor: muted])

    statusLabel.font = UIFont.systemFont(ofSize: 17, weight: .regular)
    statusLabel.textColor = ink
    statusLabel.numberOfLines = 2
    statusLabel.text = "saving to your map…"

    detailLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    detailLabel.textColor = muted
    detailLabel.numberOfLines = 2
    detailLabel.isHidden = true

    spinner.color = muted
    spinner.hidesWhenStopped = true
    spinner.startAnimating()

    let statusRow = UIStackView(arrangedSubviews: [spinner, statusLabel])
    statusRow.axis = .horizontal
    statusRow.alignment = .center
    statusRow.spacing = 10

    let column = UIStackView(arrangedSubviews: [brand, statusRow, detailLabel])
    column.axis = .vertical
    column.alignment = .leading
    column.spacing = 10
    column.setCustomSpacing(6, after: statusRow)
    column.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(column)

    let bottom = card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: 240)
    cardBottom = bottom
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      bottom,
      column.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
      column.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
      column.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
      column.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18),
    ])
    card.alpha = 0
  }

  private func showCard() {
    view.layoutIfNeeded()
    cardBottom?.constant = -12
    UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0.4) {
      self.card.alpha = 1
      self.view.layoutIfNeeded()
    }
  }

  private func setStatus(_ text: String, detail: String? = nil, busy: Bool) {
    DispatchQueue.main.async {
      self.statusLabel.text = text
      self.detailLabel.text = detail
      self.detailLabel.isHidden = (detail ?? "").isEmpty
      if busy { self.spinner.startAnimating() } else { self.spinner.stopAnimating() }
    }
  }

  @objc private func handleTap() {
    // Tapping while a save is in flight would orphan it; only a settled card dismisses.
    if !spinner.isAnimating { finish() }
  }

  private func finish(after delay: TimeInterval = 0) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      guard !self.finished else { return }
      self.finished = true
      self.cardBottom?.constant = 240
      UIView.animate(withDuration: 0.22, animations: {
        self.card.alpha = 0
        self.view.layoutIfNeeded()
      }, completion: { _ in
        self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
      })
    }
  }

  private func fail(_ message: String) {
    NSLog("[mneme-share] failed: %@", message)
    setStatus("couldn't save that", detail: message, busy: false)
    finish(after: 4.5)
  }

  // MARK: Flow

  private func start() {
    guard let token = readToken(), !token.isEmpty else {
      setStatus("sign in to mneme first", detail: "open the app, sign in, then share again.", busy: false)
      finish(after: 3.0)
      return
    }
    loadPayload { [weak self] result in
      guard let self else { return }
      switch result {
      case .failure(let error):
        self.fail(error.localizedDescription)
      case .success(let payload):
        self.save(payload, token: token)
      }
    }
  }

  private func save(_ payload: Payload, token: String) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let result = try self.upload(payload, token: token)
        var detail = result.title
        if let limit = result.limitMessage, !limit.isEmpty { detail += "\n" + limit }
        self.setStatus("saved to your map ✓", detail: detail, busy: false)
        self.finish(after: 1.4)
      } catch {
        self.fail(error.localizedDescription)
      }
    }
  }

  // MARK: Attachments

  private func loadPayload(completion: @escaping (Result<Payload, Error>) -> Void) {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
      let attachments = item.attachments, !attachments.isEmpty
    else {
      completion(.failure(RequestError(message: "nothing to share was found.")))
      return
    }
    // One capture per share. Prefer the richest representation: a Safari page
    // (property list from the JS preprocessor) or a URL beats the plain-text
    // fallback most apps also attach.
    let types: [(String, (NSItemProvider, @escaping (Result<Payload, Error>) -> Void) -> Void)] = [
      (UTType.propertyList.identifier, loadWebPage),
      (UTType.url.identifier, loadUrl),
      (UTType.pdf.identifier, loadPdf),
      (UTType.image.identifier, loadImage),
      (UTType.fileURL.identifier, loadFile),
      (UTType.plainText.identifier, loadText),
      (UTType.text.identifier, loadText),
    ]
    for (type, load) in types {
      if let attachment = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(type) }) {
        load(attachment, completion)
        return
      }
    }
    completion(.failure(RequestError(message: "that kind of content isn't supported yet.")))
  }

  private func loadWebPage(_ attachment: NSItemProvider, completion: @escaping (Result<Payload, Error>) -> Void) {
    attachment.loadItem(forTypeIdentifier: UTType.propertyList.identifier, options: nil) { item, error in
      if let dict = item as? NSDictionary,
        let results = dict[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary,
        let url = results["baseURI"] as? String, !url.isEmpty
      {
        completion(.success(.link(url)))
      } else {
        completion(.failure(error ?? RequestError(message: "couldn't read that page's address.")))
      }
    }
  }

  private func loadUrl(_ attachment: NSItemProvider, completion: @escaping (Result<Payload, Error>) -> Void) {
    attachment.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
      guard let url = item as? URL else {
        completion(.failure(error ?? RequestError(message: "couldn't read that link.")))
        return
      }
      if url.isFileURL {
        self.loadFile(attachment, completion: completion)
      } else {
        completion(.success(.link(url.absoluteString)))
      }
    }
  }

  private func loadText(_ attachment: NSItemProvider, completion: @escaping (Result<Payload, Error>) -> Void) {
    let type = attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
      ? UTType.plainText.identifier : UTType.text.identifier
    attachment.loadItem(forTypeIdentifier: type, options: nil) { item, error in
      var text: String? = item as? String
      if text == nil, let data = item as? Data { text = String(data: data, encoding: .utf8) }
      if text == nil, let attributed = item as? NSAttributedString { text = attributed.string }
      guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        completion(.failure(error ?? RequestError(message: "there was no text to save.")))
        return
      }
      // A bare link shared as text (Messages, Notes) is a link capture.
      if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(),
        (scheme == "http" || scheme == "https"), !trimmed.contains(where: { $0.isWhitespace })
      {
        completion(.success(.link(trimmed)))
      } else {
        completion(.success(.text(trimmed)))
      }
    }
  }

  private func loadImage(_ attachment: NSItemProvider, completion: @escaping (Result<Payload, Error>) -> Void) {
    attachment.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, error in
      var image: UIImage? = item as? UIImage
      if image == nil, let url = item as? URL, let data = try? Data(contentsOf: url) { image = UIImage(data: data) }
      if image == nil, let data = item as? Data { image = UIImage(data: data) }
      guard let image, let jpeg = image.jpegData(compressionQuality: 0.85) else {
        completion(.failure(error ?? RequestError(message: "couldn't read that image.")))
        return
      }
      completion(.success(.file(jpeg, mimeType: "image/jpeg", isPdf: false)))
    }
  }

  private func loadPdf(_ attachment: NSItemProvider, completion: @escaping (Result<Payload, Error>) -> Void) {
    attachment.loadItem(forTypeIdentifier: UTType.pdf.identifier, options: nil) { item, error in
      var data: Data? = item as? Data
      if data == nil, let url = item as? URL { data = try? Data(contentsOf: url) }
      guard let data else {
        completion(.failure(error ?? RequestError(message: "couldn't read that PDF.")))
        return
      }
      completion(.success(.file(data, mimeType: "application/pdf", isPdf: true)))
    }
  }

  private func loadFile(_ attachment: NSItemProvider, completion: @escaping (Result<Payload, Error>) -> Void) {
    attachment.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
      guard let url = item as? URL, let data = try? Data(contentsOf: url) else {
        completion(.failure(error ?? RequestError(message: "couldn't read that file.")))
        return
      }
      let ext = url.pathExtension.lowercased()
      if ext == "pdf" {
        completion(.success(.file(data, mimeType: "application/pdf", isPdf: true)))
      } else if let type = UTType(filenameExtension: ext), type.conforms(to: .image) {
        // Re-encode so HEIC and friends arrive as JPEG the backend can read.
        guard let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) else {
          completion(.failure(RequestError(message: "couldn't read that image.")))
          return
        }
        completion(.success(.file(jpeg, mimeType: "image/jpeg", isPdf: false)))
      } else {
        completion(.failure(RequestError(message: "that file type isn't supported yet.")))
      }
    }
  }

  // MARK: Backend

  private func upload(_ payload: Payload, token: String) throws -> SaveResult {
    let tzOffsetMinutes = TimeZone.current.secondsFromGMT() / 60
    var body: [String: Any] = ["tzOffsetMinutes": tzOffsetMinutes]
    switch payload {
    case .link(let url):
      body["kind"] = "LINK"
      body["url"] = url
    case .text(let text):
      body["kind"] = "TEXT"
      body["text"] = String(text.prefix(8000))
    case .file(let data, let mimeType, let isPdf):
      if data.count > 20 * 1024 * 1024 {
        throw RequestError(message: "that file is too large to save from the share sheet.")
      }
      let uploaded = try post(path: "/api/captures/upload", json: ["imageBase64": data.base64EncodedString(), "mimeType": mimeType], token: token)
      guard let mediaUrl = uploaded["mediaUrl"] as? String else {
        throw RequestError(message: "the upload didn't come back with a file address.")
      }
      // A PDF is a document: captured as a LINK so the server reads its text
      // instead of sending it to the image model.
      if isPdf {
        body["kind"] = "LINK"
        body["url"] = mediaUrl
      } else {
        body["kind"] = "IMAGE"
        body["mediaUrl"] = mediaUrl
      }
    }
    let capture = try post(path: "/api/captures", json: body, token: token)
    let title = (capture["title"] as? String) ?? ""
    let limit = (capture["usageLimit"] as? [String: Any])?["message"] as? String
    return SaveResult(title: title, limitMessage: limit)
  }

  /// POST JSON, unwrap the `{ ok, data | error }` envelope, return `data`.
  private func post(path: String, json: [String: Any], token: String) throws -> [String: Any] {
    guard let url = URL(string: apiBaseUrl + path) else { throw RequestError(message: "bad backend address.") }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    request.httpBody = try JSONSerialization.data(withJSONObject: json)
    // The capture pipeline runs to completion before answering; big sources
    // (video transcripts, PDFs) take a while.
    request.timeoutInterval = 120

    let semaphore = DispatchSemaphore(value: 0)
    var outData: Data?
    var outResponse: URLResponse?
    var outError: Error?
    let session = URLSession(configuration: .ephemeral)
    session.dataTask(with: request) { data, response, error in
      outData = data
      outResponse = response
      outError = error
      semaphore.signal()
    }.resume()
    semaphore.wait()

    if outError != nil {
      throw RequestError(message: "can't reach mneme. check your connection and try again.")
    }
    let status = (outResponse as? HTTPURLResponse)?.statusCode ?? 0
    guard let data = outData,
      let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw RequestError(message: "the server had a problem (\(status)). try again in a moment.")
    }
    if (envelope["ok"] as? Bool) == true, let payload = envelope["data"] as? [String: Any] {
      return payload
    }
    let error = envelope["error"] as? [String: Any]
    if (error?["code"] as? String) == "UNAUTHORIZED" {
      throw RequestError(message: "your session expired. open mneme to sign in again.")
    }
    throw RequestError(message: (error?["message"] as? String) ?? "the server had a problem (\(status)).")
  }

  // MARK: Keychain

  private func readToken() -> String? {
    let key = Data(tokenKey.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrGeneric as String: key,
      kSecAttrAccount as String: key,
      kSecAttrAccessGroup as String: appGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else {
      NSLog("[mneme-share] no session token in keychain (status %d)", status)
      return nil
    }
    return String(data: data, encoding: .utf8)
  }
}

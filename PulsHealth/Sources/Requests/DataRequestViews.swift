import SwiftUI
import AVFoundation
import CoreImage.CIFilterBuiltins
import PulsHealthSync

struct CreateDataRequestView: View {
    @State private var title = ""
    @State private var requester = ""
    @State private var purpose = ""
    @State private var contact = ""
    @State private var start = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var end = Date()
    @State private var metrics: [DataRequest.Metric] = []
    @State private var format: ExportFormat = .csv
    @State private var sends = false
    @State private var destinationName = ""
    @State private var endpoint = ""
    @State private var link: URL?
    @State private var problem: String?

    var body: some View {
        Form {
            Section("About This Request") {
                TextField("Request name", text: $title)
                TextField("Requested by", text: $requester)
                TextField("Purpose", text: $purpose)
                TextField("Contact email or phone", text: $contact)
            }
            Section("Data & Dates") {
                NavigationLink("Data types (\(metrics.count))") { RequestMetricPicker(metrics: $metrics) }
                DatePicker("From", selection: $start, in: ...Date(), displayedComponents: .date)
                DatePicker("Through", selection: $end, in: ...Date(), displayedComponents: .date)
                Picker("Format", selection: $format) {
                    Text("CSV").tag(ExportFormat.csv)
                    Text("JSONL").tag(ExportFormat.jsonl)
                }
                Text("Both dates included, in the participant’s time zone. One ZIP includes the data and export summary. Workout routes and extra streams are not requested.").font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                Toggle("Send to a destination", isOn: $sends)
                if sends {
                    TextField("Destination name", text: $destinationName)
                    TextField("HTTPS upload endpoint", text: $endpoint)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Text("Use a compatible PulsHealth request receiver, not an email address, folder link or database password. The participant confirms Generate & Send before any upload.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("Generate & Share opens the iOS share sheet so the participant can choose where the ZIP goes.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } header: { Text("Delivery") }
            if let problem { Section { Text(problem).foregroundStyle(.red) } }
            Section {
                Button("Create Link & QR Code") { create() }
                Text("One-time request. No account or ongoing sync. Links expire after 30 days and can be reused by different people. Anyone with the link can see its request details; it contains no health data or upload credentials.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Create Request")
        .navigationDestination(isPresented: Binding(get: { link != nil }, set: { if !$0 { link = nil } })) {
            if let link { RequestCodeView(link: link) }
        }
    }
    private func create() {
        do {
            var destination: DataRequest.Destination?
            if sends {
                guard let url = URL(string: endpoint.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                    throw DataRequest.Invalid("Enter an HTTPS upload endpoint.")
                }
                destination = .init(name: destinationName, url: url)
            }
            let request = DataRequest(title: title, requester: requester, purpose: purpose, contact: contact,
                startDay: DataRequest.day(start), endDay: DataRequest.day(end), metrics: metrics,
                format: format, destination: destination)
            link = try request.link(); problem = nil
        } catch { problem = error.localizedDescription }
    }
}

struct RequestMetricPicker: View {
    @Binding var metrics: [DataRequest.Metric]
    @State private var search = ""
    private var types: [HealthTypeDescriptor] {
        HealthTypeCatalog.all.filter { search.isEmpty || $0.displayName.localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        List {
            ForEach(types, id: \.identifier) { type in
                VStack(alignment: .leading) {
                    Toggle(type.displayName, isOn: Binding(
                        get: { metrics.contains { $0.type == type.identifier } },
                        set: { selected in
                            if selected { metrics.append(.init(type: type.identifier)) }
                            else { metrics.removeAll { $0.type == type.identifier } }
                        }))
                    if let index = metrics.firstIndex(where: { $0.type == type.identifier }) {
                        Picker("Detail", selection: Binding(
                            get: { metrics.first(where: { $0.type == type.identifier })?.function?.rawValue ?? "raw" },
                            set: { value in
                                if let i = metrics.firstIndex(where: { $0.type == type.identifier }) {
                                    metrics[i].function = AggregateFunction(rawValue: value)
                                }
                            })) {
                            Text("Individual records").tag("raw")
                            ForEach(HealthTypeCatalog.allowedAggregateFunctions(for: metrics[index].type)) { function in
                                Text("Daily \(function.displayName.lowercased())").tag(function.rawValue)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Requested Data").searchable(text: $search)
    }
}

enum RequestQRCode {
    static func image(for link: URL) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(link.absoluteString.utf8); filter.correctionLevel = "L"
        guard let output = filter.outputImage else { return nil }
        // A four-module quiet zone belongs in the shared image, not just the view.
        let bounds = output.extent.insetBy(dx: -4, dy: -4)
        let padded = output.composited(over: CIImage(color: .white).cropped(to: bounds))
        let scale = CGAffineTransform(scaleX: 6, y: 6)
        guard let image = CIContext().createCGImage(padded.transformed(by: scale), from: bounds.applying(scale)) else { return nil }
        return UIImage(cgImage: image)
    }
}

struct RequestCodeView: View {
    let link: URL
    private var qr: UIImage? { RequestQRCode.image(for: link) }
    var body: some View {
        List {
            Section {
                if let qr {
                    Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                        .padding(16).background(.white).accessibilityLabel("PulsHealth request QR code")
                    ShareLink(item: Image(uiImage: qr), preview: SharePreview("PulsHealth request", image: Image(uiImage: qr))) {
                        Label("Share QR Code", systemImage: "square.and.arrow.up")
                    }
                } else { Text("The QR code could not be generated. Share the link instead.") }
                ShareLink("Share Request Link", item: link)
                Text(link.absoluteString).font(.caption2).textSelection(.enabled).lineLimit(4)
            }
            Section {
                Text("Open this link or scan the code with PulsHealth installed. If it isn’t installed, install PulsHealth, then reopen the same link. Settings → Open or Scan Request also accepts a pasted link.")
                Link("Get PulsHealth", destination: URL(string: "https://apps.apple.com/app/id6757657354")!)
                Text("The requester’s identity is not verified by this code. Editing the request creates a different link; an existing link cannot be recalled.")
            }
        }.navigationTitle("Request Link & QR")
    }
}

struct OpenDataRequestView: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var scanning = false
    @State private var scanned = false
    var body: some View {
        Form {
            Section {
                TextField("Paste a PulsHealth request link", text: $text, axis: .vertical)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Open Request") { model.dataRequests.open(text) }.disabled(text.isEmpty)
                Button("Scan Request QR Code", systemImage: "qrcode.viewfinder") { scanning = true }
            } footer: { Text("You’ll review the data, dates and destination before generating anything.") }
        }
        .navigationTitle("Open Request")
        .sheet(isPresented: $scanning, onDismiss: {
            if scanned { scanned = false; model.dataRequests.open(text) }
        }) {
            RequestScanner { code in
                text = code
                scanned = true
                scanning = false
            }
        }
    }
}

private struct RequestScanner: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var allowed = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    @State private var problem: String?
    @State private var done = false
    var body: some View {
        NavigationStack {
            VStack {
                if allowed {
                    CameraPreview(onCode: { code in
                        guard !done else { return }
                        do { _ = try DataRequest.parse(code); done = true; onCode(code) }
                        catch { problem = error.localizedDescription }
                    }, onFailure: { problem = $0 })
                    Text("Scan a PulsHealth request code. You will review the request after scanning.")
                } else {
                    Text("The camera is used only to read a QR code. No images are saved. You can also paste a request link.")
                    Button("Allow Camera Access") {
                        Task { allowed = await AVCaptureDevice.requestAccess(for: .video) }
                    }
                    Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
                }
                if let problem { Text(problem).foregroundStyle(.red) }
            }.padding().navigationTitle("Scan Request")
                .toolbar { Button("Done") { dismiss() } }
        }
    }
}

struct FulfillDataRequestView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let requests = model.dataRequests
        List {
            if let request = requests.pending {
                Section {
                    Text(request.title).font(.title2.bold())
                    LabeledContent("Requested by", value: request.requester)
                    Text(request.purpose)
                    Text(request.contact).font(.footnote)
                    Text("Requester details are supplied by the link and are not verified. This is a one-time export, not study enrollment or ongoing sync.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Requested Data") {
                    ForEach(request.metrics) { metric in
                        LabeledContent(HealthTypeCatalog.descriptor(for: metric.type)?.displayName ?? metric.type,
                            value: metric.function.map { "Daily \($0.displayName.lowercased())" } ?? "Individual records")
                    }
                    LabeledContent("From", value: request.startDay)
                    LabeledContent("Through", value: request.endDay)
                    LabeledContent("Time zone", value: TimeZone.current.identifier)
                    LabeledContent("ZIP contents", value: request.format.rawValue.uppercased())
                }
                Section("Delivery") {
                    if let destination = request.destination {
                        Text(destination.name).font(.headline)
                        Text(destination.url.absoluteString).textSelection(.enabled)
                        Text("Generate & Send creates the ZIP and immediately uploads it here. Partial exports stop for your review. Received copies are controlled by the recipient and cannot be recalled from this app.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else { Text("Generate & Share opens the share sheet. You choose where the file goes.") }
                    Text("Keep the app open and the phone unlocked. Apple Health may ask which types PulsHealth can read. Empty results do not establish whether access was granted.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error = requests.error { Section { Text(error).foregroundStyle(.red) } }
                if requests.isBusy {
                    Section {
                        ProgressView(requests.sending ? "Sending export…" : "Generating export…")
                        if let progress = requests.progress { Text("\(progress.rowsWritten.formatted()) rows written") }
                        Button("Cancel", role: .cancel) { requests.cancel() }
                    }
                } else if let receipt = requests.receipt {
                    Section("Export Received") {
                        Text("The destination confirmed receipt.")
                        Text(receipt.receipt).font(.caption).textSelection(.enabled)
                    }
                } else if requests.handedOff {
                    Section { Text("The share sheet handed off your file. PulsHealth cannot confirm the requester received it.") }
                } else if let result = requests.result {
                    Section("Export Generated") {
                        Text("\(result.totalRows.formatted()) rows · \(result.totalBytes.formatted()) bytes")
                        if !result.isComplete || !result.notRepresented.isEmpty || !result.warnings.isEmpty {
                            Text("Some requested data could not be included. The summary in the ZIP records extraction limitations.").foregroundStyle(.orange)
                            ForEach(Array(result.failures.enumerated()), id: \.offset) { _, issue in Text(issue.message).font(.footnote) }
                            ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, issue in Text(issue.message).font(.footnote) }
                            ForEach(result.notRepresented.keys.sorted(by: { $0.rawValue < $1.rawValue }), id: \.self) { dataset in
                                Text("Not included: \(dataset.rawValue)").font(.footnote)
                            }
                            ForEach(result.unmappableSamples.keys.sorted(), id: \.self) { type in
                                Text("Some samples could not be converted: \(type)").font(.footnote)
                            }
                            ForEach(result.limitedHistory.keys.sorted(), id: \.self) { type in Text("Limited history: \(type)").font(.footnote) }
                        }
                        if request.destination != nil {
                            Button(result.isComplete && result.notRepresented.isEmpty && result.warnings.isEmpty ? "Retry Send" : "Send Available Data") { requests.retrySend() }
                        } else { Button("Share or Save") { requests.showShare() } }
                        Button("Delete Export", role: .destructive) { requests.discard() }
                        Text("Temporary files are removed when this request closes or the app relaunches.").font(.footnote)
                    }
                } else {
                    Section {
                        Button(request.destination == nil ? "Generate & Share" : "Generate & Send") {
                            requests.start(configuration: model.appliedConfig) { selection in
                                await model.requestHealthAccessForExport(selection: selection)
                            }
                        }.disabled(model.export.isRunning || model.backfillActive)
                        if model.export.isRunning || model.backfillActive { Text("Wait for the current export or backfill to finish.") }
                    }
                }
            }
        }
        .navigationTitle("Data Request").navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(requests.isBusy || requests.sharing)
        .toolbar { Button("Done") { requests.close() }.disabled(requests.isBusy || requests.sharing) }
        .background(ActivitySheet(isPresented: Binding(get: { requests.sharing }, set: { if !$0 { requests.hideShare() } }),
            items: requests.result?.files ?? [], onFinish: { requests.shareFinished($0) }))
    }
}

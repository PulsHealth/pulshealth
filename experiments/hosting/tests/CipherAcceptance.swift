import CryptoKit
import Foundation

@main enum CipherAcceptance {
    static func main() throws {
        let fixture = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        let key = Data(base64Encoded: fixture["privateKey"]!)!
        let publicKey = Data(base64Encoded: fixture["publicKey"]!)!
        let body = Data(base64Encoded: fixture["sealed"]!)!
        let context = Data(fixture["context"]!.utf8)
        let expected = Data(fixture["plaintext"]!.utf8)
        let goOpened = try VaultCipher.open(body, privateKey: key, context: context)
        precondition(goOpened == expected)
        let swiftBody = try VaultCipher.seal(expected, recipientKey: publicKey, context: context)
        let swiftOpened = try VaultCipher.open(swiftBody, privateKey: key, context: context)
        precondition(swiftOpened == expected)
        for invalid in [context + Data([1]), Data()] {
            do { _ = try VaultCipher.open(body, privateKey: key, context: invalid); fatalError("context substitution accepted") }
            catch { }
        }
        var tampered = body; tampered[tampered.count - 1] ^= 1
        do { _ = try VaultCipher.open(tampered, privateKey: key, context: context); fatalError("tamper accepted") }
        catch { }
        try swiftBody.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
        print("Swift opened Go ciphertext, verified roundtrip and rejected tampering/context substitution")
    }
}

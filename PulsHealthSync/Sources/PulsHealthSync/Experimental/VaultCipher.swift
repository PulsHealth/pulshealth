import CryptoKit
import Foundation

/// Experimental envelope format shared by native writers and customer readers.
public enum VaultCipher {
    public static let partSize = 1_048_576
    /// Shared with the customer-side Go reader; all context is authenticated.
    public static func context(participant: String, commit: String, part: Int) -> Data {
        Data("puls-vault-v1\n\(participant)\n\(commit)\n\(part)".utf8)
    }
    public static func seal(_ plaintext: Data, recipientKey: Data, context: Data) throws -> Data {
        guard plaintext.count <= partSize else { throw CryptoKitError.incorrectParameterSize }
        let ephemeral = Curve25519.KeyAgreement.PrivateKey()
        let recipient = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: recipientKey)
        let shared = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data("puls-vault-v1".utf8), sharedInfo: context, outputByteCount: 32)
        let sealed = try AES.GCM.seal(plaintext, using: key, authenticating: context)
        guard let combined = sealed.combined else { throw CryptoKitError.incorrectParameterSize }
        return ephemeral.publicKey.rawRepresentation + combined
    }
    public static func open(_ body: Data, privateKey: Data, context: Data) throws -> Data {
        guard body.count >= 60, body.count <= partSize + 60 else { throw CryptoKitError.incorrectParameterSize }
        let recipient = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey)
        let ephemeral = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: body.prefix(32))
        let shared = try recipient.sharedSecretFromKeyAgreement(with: ephemeral)
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data("puls-vault-v1".utf8), sharedInfo: context, outputByteCount: 32)
        let box = try AES.GCM.SealedBox(combined: body.dropFirst(32))
        return try AES.GCM.open(box, using: key, authenticating: context)
    }

}

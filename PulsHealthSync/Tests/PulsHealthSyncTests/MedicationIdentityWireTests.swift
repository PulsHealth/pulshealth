import Foundation
import Testing
@testable import PulsHealthSync

@Suite struct MedicationIdentityWireTests {
    @Test func identityRoundTripsAndLegacyPayloadsRemainReadable() throws {
        let detail = MedicationDoseDetail(
            medication: "Shared display label", medicationID: "d1000000-0000-4000-8000-000000000001",
            status: "taken")
        let encoded = try JSONEncoder.puls.encode(detail)
        let fields = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(fields["medicationID"] as? String == detail.medicationID)
        #expect(try JSONDecoder.puls.decode(MedicationDoseDetail.self, from: encoded) == detail)
        let legacy = Data(#"{"medication":"Shared display label","status":"taken"}"#.utf8)
        #expect(try JSONDecoder.puls.decode(MedicationDoseDetail.self, from: legacy).medicationID == nil)
        let missing = try JSONEncoder.puls.encode(MedicationDoseDetail(status: "taken"))
        let missingFields = try #require(JSONSerialization.jsonObject(with: missing) as? [String: Any])
        #expect(missingFields["medicationID"] == nil)
    }
}

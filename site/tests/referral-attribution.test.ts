import {test} from "node:test";
import assert from "node:assert/strict";
import {referralSlug,referralStoreURL,isPulsAppStoreLink} from "../src/lib/referral-attribution";
test("only a bounded shared referral slug can select the fixed App Store route",()=>{
 assert.equal(referralSlug("other=value; __Host-puls-campaign=newsletter-12345678"),"newsletter-12345678");
 for(const value of ["", "__Host-puls-campaign=", "__Host-puls-campaign=bad%40email", "__Host-puls-campaign=%E0", "__Host-puls-campaign=../private", "__Host-puls-campaign=abc; __Host-puls-campaign=def"])assert.equal(referralSlug(value),null);
 assert.equal(referralStoreURL("newsletter-12345678"),"https://pulshealth.com/r/newsletter-12345678/store");
 assert.equal(referralStoreURL("https://evil.example"),"https://apps.apple.com/us/app/pulshealth/id6757657354");
 assert.equal(isPulsAppStoreLink("https://apps.apple.com/us/app/pulshealth/id6757657354?mt=8"),true);
 for(const url of ["https://apps.apple.com/app/id123", "https://apps.apple.com.evil.example/app/id6757657354", "http://apps.apple.com/app/id6757657354", "javascript:alert(1)"])assert.equal(isPulsAppStoreLink(url),false);
});

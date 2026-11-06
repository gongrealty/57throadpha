// PRIVATE tier of /compare: street addresses + agent watch-outs for each contender.
// Files starting with _ are not routes. This data only leaves the server through
// api/compare.js, and only to a browser holding a valid unlock cookie.
// Source: public listing check, market snapshot Nov 5, 2026 (asking prices, not verified with listing agents).
module.exports = {
  c1:  { addr: '74-49 Calamus Ave #51',         watch: 'Third-floor walk-up with 1.5 baths. Smaller outdoor space.' },
  c2:  { addr: '63-14 Queens Blvd #3R',         watch: 'Garage space is not included. Balcony, not a terrace.' },
  c3:  { addr: '97-45 63rd Dr #7A',             watch: 'Tax abatement ends in 2033, so today\'s low carry rises. Parking not included.' },
  c4:  { addr: '70-26 Queens Blvd #7A',         watch: 'Tax abatement ends in 2032. 189 sf smaller and one bedroom fewer.' },
  c5:  { addr: '100-05 37th Ave #1B',           watch: 'Listed charges ($350/yr) and taxes ($280/yr) are unusually low. Get them in writing. Ground floor.' },
  c6:  { addr: '116-24 Grosvenor Ln #7C',       watch: 'About $1,791/mo in charges and taxes. Valet garage costs extra.' },
  c7:  { addr: '72-52 Metropolitan Ave #2B',    watch: '209 sf smaller with two bedrooms.' },
  c8:  { addr: '33-30 61st St #105',            watch: 'Confirm any extra parking-related charges.' },
  c9:  { addr: '41-58 71st St #4B',             watch: 'A parking spot is $48K extra, plus monthly costs.' },
  c10: { addr: '66-41 69th St #1E',             watch: 'Only 890 sf, barely an upgrade in space.' },
  c11: { addr: '92-29 Queens Blvd #9D',         watch: 'Only 852 sf with 1.5 baths.' },
  c12: { addr: '62-98 Woodhaven Blvd #50',      watch: '950 sf. Garage not included.' },
  c13: { addr: '64-34 Grand Central Pkwy #3G',  watch: 'Parking unconfirmed. About $1,143/mo in charges and taxes.' },
  c14: { addr: '41-35 67th St #4A',             watch: 'Taxes around $13,530/yr offset the lower price.' },
  c15: { addr: '35-20 Leverich St #209',        watch: '$1,178/mo HOA plus an assessment and taxes. Garage space not confirmed.' },
  c16: { addr: '65-38 Austin St #4D',           watch: 'Garage space is $60K extra, about $858K all-in. Only 935 sf.' },
  c17: { addr: '45-16 83rd St #E8F',            watch: 'No parking listed. Fees need confirmation.' },
  c18: { addr: '87-30 62nd Ave #101',           watch: 'About $2,228 to $2,490/mo in charges, taxes and an assessment running to Aug 2030.' },
  c19: { addr: '51-09 99th St #12C',            watch: 'One bathroom. Garage status unconfirmed.' },
  c20: { addr: '102-10 Queens Blvd #403',       watch: '$603/mo charges plus $921/mo taxes. Parking not included.' },
  c21: { addr: '35-61 84th St #601',            watch: 'No confirmed parking. 980 sf.' },
  h1:  { addr: '64-45 79th St',                 watch: '1.5 baths. Roof, boiler, facade and drainage are all the buyer\'s.' },
  h2:  { addr: '77-22 83rd St',                 watch: 'Advertised 1,850 sf may include the basement. Verify above-grade size.' },
  h3:  { addr: '90-16 Union Tpke',              watch: '1.5 baths and $49K more.' },
  h4:  { addr: '85-05 67th Dr',                 watch: '$68K more with 1.5 baths.' },
  h5:  { addr: '69-20 67th Pl',                 watch: 'Needs renovation. Only a deal after renovation costs.' },
  h6:  { addr: '64-91 82nd Pl',                 watch: '$98K over PHA\'s asking price.' },
  h7:  { addr: '61-66 78th St',                 watch: '1,152 sf, smaller than PHA.' },
  h8:  { addr: '87-09 69th Ave',                watch: 'Seller says the house needs TLC.' },
  h9:  { addr: '74-31 64th St',                 watch: '$49K more. Semi-detached.' },
  h10: { addr: '79-52 77th Ave',                watch: '1.5 baths. Parking not verified.' },
  h11: { addr: '78-51 80th St',                 watch: 'Bath count and parking unconfirmed.' }
};

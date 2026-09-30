// Keep nickname styling; entity-name normalization remains a separate policy.
const RGI_EMOJI = new RegExp("\\p{RGI_Emoji}", "gv");
const TEXT_EMOJI = /\p{Emoji}\uFE0E/gu;
const IDEOGRAPH_VARIANT = /\p{Unified_Ideograph}[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
const MONGOLIAN_VARIANT = /(?=\p{L})\p{Script_Extensions=Mongolian}[\u180B-\u180D\u180F]/gu;
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u;
const NONSPACING_MARK = /\p{Mn}/u;
const TRANSPARENT_MARK = /[\p{Mn}\p{Me}]/u;
const LETTER = /\p{L}/u;
const SHARED_SCRIPT = /[\p{Script=Common}\p{Script=Inherited}]/u;

// Unicode 17.0 properties absent from JavaScript's Unicode property escapes.
// Sources: https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt
//          https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedJoiningType.txt
//          https://www.unicode.org/Public/17.0.0/ucd/Scripts.txt
const VIRAMA = /[\u094d\u09cd\u0a4d\u0acd\u0b4d\u0bcd\u0c4d\u0ccd\u0d3b-\u0d3c\u0d4d\u0dca\u0e3a\u0eba\u0f84\u1039-\u103a\u1714-\u1715\u1734\u17d2\u1a60\u1b44\u1baa-\u1bab\u1bf2-\u1bf3\u2d7f\ua806\ua82c\ua8c4\ua953\ua9c0\uaaf6\uabed\u{10a3f}\u{11046}\u{11070}\u{1107f}\u{110b9}\u{11133}-\u{11134}\u{111c0}\u{11235}\u{112ea}\u{1134d}\u{113ce}-\u{113d0}\u{11442}\u{114c2}\u{115bf}\u{1163f}\u{116b6}\u{1172b}\u{11839}\u{1193d}-\u{1193e}\u{119e0}\u{11a34}\u{11a47}\u{11a99}\u{11c3f}\u{11d44}-\u{11d45}\u{11d97}\u{11f41}-\u{11f42}\u{1612f}]/u;
const LEFT_JOINING = /[\u0620\u0626\u0628\u062a-\u062e\u0633-\u063f\u0641-\u0647\u0649-\u064a\u066e-\u066f\u0678-\u0687\u069a-\u06bf\u06c1-\u06c2\u06cc\u06ce\u06d0-\u06d1\u06fa-\u06fc\u06ff\u0712-\u0714\u071a-\u071d\u071f-\u0727\u0729\u072b\u072d-\u072e\u074e-\u0758\u075c-\u076a\u076d-\u0770\u0772\u0775-\u0777\u077a-\u077f\u07ca-\u07ea\u0841-\u0845\u0848\u084a-\u0853\u0855\u0860\u0862-\u0865\u0868\u0886\u0889-\u088d\u088f\u08a0-\u08a9\u08af-\u08b0\u08b3-\u08b8\u08ba-\u08c8\u1807\u1820-\u1878\u1887-\u18a8\u18aa\ua840-\ua872\u{10ac0}-\u{10ac4}\u{10acd}\u{10ad3}-\u{10adc}\u{10ade}-\u{10ae0}\u{10aeb}-\u{10aee}\u{10b80}\u{10b82}\u{10b86}-\u{10b88}\u{10b8a}-\u{10b8b}\u{10b8d}\u{10b90}\u{10bad}-\u{10bae}\u{10d00}-\u{10d21}\u{10d23}\u{10ec3}-\u{10ec4}\u{10ec6}-\u{10ec7}\u{10f30}-\u{10f32}\u{10f34}-\u{10f44}\u{10f51}-\u{10f53}\u{10f70}-\u{10f73}\u{10f76}-\u{10f81}\u{10fb0}\u{10fb2}-\u{10fb3}\u{10fb8}\u{10fbb}-\u{10fbc}\u{10fbe}-\u{10fbf}\u{10fc1}\u{10fc4}\u{10fca}-\u{10fcb}\u{1e900}-\u{1e943}]/u;
const RIGHT_JOINING = /[\u0620\u0622-\u063f\u0641-\u064a\u066e-\u066f\u0671-\u0673\u0675-\u06d3\u06d5\u06ee-\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u077f\u07ca-\u07ea\u0840-\u0858\u0860\u0862-\u0865\u0867-\u086a\u0870-\u0882\u0886\u0889-\u088f\u08a0-\u08ac\u08ae-\u08c8\u1807\u1820-\u1878\u1887-\u18a8\u18aa\ua840-\ua871\u{10ac0}-\u{10ac5}\u{10ac7}\u{10ac9}-\u{10aca}\u{10ace}-\u{10ad6}\u{10ad8}-\u{10ae1}\u{10ae4}\u{10aeb}-\u{10aef}\u{10b80}-\u{10b91}\u{10ba9}-\u{10bae}\u{10d01}-\u{10d23}\u{10ec2}-\u{10ec4}\u{10ec6}-\u{10ec7}\u{10f30}-\u{10f44}\u{10f51}-\u{10f54}\u{10f70}-\u{10f81}\u{10fb0}\u{10fb2}-\u{10fb6}\u{10fb8}-\u{10fbf}\u{10fc1}-\u{10fc4}\u{10fc9}-\u{10fca}\u{1e900}-\u{1e943}]/u;
const JOINING_SCRIPTS = [
  "Adlam",
  "Ahom",
  "Arabic",
  "Balinese",
  "Batak",
  "Bengali",
  "Bhaiksuki",
  "Brahmi",
  "Chakma",
  "Chorasmian",
  "Devanagari",
  "Dives_Akuru",
  "Dogra",
  "Grantha",
  "Gujarati",
  "Gunjala_Gondi",
  "Gurmukhi",
  "Gurung_Khema",
  "Hanifi_Rohingya",
  "Hanunoo",
  "Javanese",
  "Kaithi",
  "Kannada",
  "Kawi",
  "Kharoshthi",
  "Khmer",
  "Khojki",
  "Khudawadi",
  "Lao",
  "Malayalam",
  "Mandaic",
  "Manichaean",
  "Masaram_Gondi",
  "Meetei_Mayek",
  "Modi",
  "Mongolian",
  "Myanmar",
  "Nandinagari",
  "Newa",
  "Nko",
  "Old_Uyghur",
  "Oriya",
  "Phags_Pa",
  "Psalter_Pahlavi",
  "Rejang",
  "Saurashtra",
  "Sharada",
  "Siddham",
  "Sinhala",
  "Sogdian",
  "Soyombo",
  "Sundanese",
  "Syloti_Nagri",
  "Syriac",
  "Tagalog",
  "Tai_Tham",
  "Takri",
  "Tamil",
  "Telugu",
  "Thai",
  "Tibetan",
  "Tifinagh",
  "Tirhuta",
  "Tulu_Tigalari",
  "Zanabazar_Square",
].map((script) => new RegExp(`\\p{Script_Extensions=${script}}`, "u"));

function shareJoiningScript(...characters: string[]): boolean {
  return JOINING_SCRIPTS.some((script) =>
    characters.every((character) =>
      SHARED_SCRIPT.test(character) || script.test(character)),
  );
}

function hasJoinerContext(characters: string[], index: number): boolean {
  const previous = characters[index - 1] ?? "";
  const next = characters[index + 1] ?? "";
  // A conjunct: a letter and virama, then a joiner and a letter of the same script.
  // Deliberately require the virama and following letter to be adjacent to the joiner.
  if (VIRAMA.test(previous) && LETTER.test(next)) {
    let start = index - 2;
    while (start >= 0 && NONSPACING_MARK.test(characters[start])) start--;
    const letter = characters[start] ?? "";
    if (LETTER.test(letter) &&
      shareJoiningScript(...characters.slice(start, index), next))
      return true;
  }
  if (characters[index] !== "\u200C") return false;
  // A ZWNJ can break a cursive connection between compatible joining letters.
  let start = index - 1;
  while (start >= 0 && TRANSPARENT_MARK.test(characters[start]) &&
    !LEFT_JOINING.test(characters[start]) && !RIGHT_JOINING.test(characters[start])) start--;
  const left = characters[start] ?? "";
  return LEFT_JOINING.test(left) && RIGHT_JOINING.test(next) &&
    shareJoiningScript(...characters.slice(start, index), next);
}

export function inspectDisplayName(value: string): {
  displayName: string;
  error: string | null;
} {
  const canonical = value.normalize("NFC");
  const displayName = canonical.trim().replace(/\s+/gu, " ");
  // Validate before trimming so BOM, line breaks and other controls cannot disappear.
  // A placeholder prevents allowed sequences from creating new joiner contexts.
  const characters = [...canonical
    .replace(TEXT_EMOJI, " ")
    .replace(RGI_EMOJI, " ")
    .replace(IDEOGRAPH_VARIANT, " ")
    .replace(MONGOLIAN_VARIANT, " ")];
  const forbidden = characters.some((character, index) =>
    FORBIDDEN.test(character) &&
    !((character === "\u200C" || character === "\u200D") &&
      hasJoinerContext(characters, index)),
  );
  const error = forbidden
    ? "显示名不能包含控制字符或不可见字符"
    : !displayName || [...displayName].length > 80
      ? "显示名长度必须为 1 至 80 个字符"
      : null;
  return { displayName, error };
}

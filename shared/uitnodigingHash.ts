/**
 * De link in een uitnodiging is `<portaal>/#uitnodiging=<code>`; een hash,
 * want die gaat nooit naar een server of in een toegangslog. Een eigen
 * module omdat App.tsx (startbundel) alleen deze sleutel nodig heeft: met een
 * import uit shared/uitnodiging.ts belandde die hele module in index-*.js.
 */
export const UITNODIGING_HASH = '#uitnodiging=';

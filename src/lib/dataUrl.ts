/**
 * Een gekozen bestand lezen als data-URL (base64), de vorm waarin het portaal
 * bestanden naar de API stuurt (ritblad, documenten, PDF-bijlagen).
 *
 * Eén helper voor elk uploadscherm (controle-ronde 29-09, nr. 31): er stonden
 * vier kopieën van deze acht regels. Bewust een eigen module zonder imports:
 * het ritbladscherm van de chauffeur gebruikt hem ook, en dat mag de
 * beheercomponenten van src/components/PdfBijlagen.tsx niet meeslepen.
 * Groottegrenzen en foutteksten horen bij het scherm, niet hier.
 */
export async function leesAlsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Kon bestand niet lezen.'));
    reader.readAsDataURL(file);
  });
}

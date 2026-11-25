/** mammoth's prebuilt browser bundle (the package types only its Node entry). */
declare module 'mammoth/mammoth.browser.js' {
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { styleMap?: string[] },
  ): Promise<{ value: string; messages: unknown[] }>;
}

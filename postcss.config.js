import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

/**
 * Rozmiary czcionek w px (np. arbitralne `text-[13px]`) → rem (13px = 0.8125rem przy bazie 16px).
 * Wygląd przy domyślnym rozmiarze bez zmian, a tekst skaluje się razem z rozmiarem czcionki <html>:
 * ustawienie "Rozmiar tekstu" (src/lib/accessibility.ts) i bazowy rozmiar czcionki przeglądarki.
 */
const pxFontSizeToRem = {
  postcssPlugin: 'px-font-size-to-rem',
  OnceExit(root) {
    root.walkDecls(/^(font-size|line-height)$/, (decl) => {
      const px = /^(\d*\.?\d+)px$/.exec(decl.value.trim());
      if (px) decl.value = `${Number(px[1]) / 16}rem`;
    });
  },
};

export default {
  plugins: [tailwindcss, autoprefixer, pxFontSizeToRem],
};

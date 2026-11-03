# Proposal source

All wording lives in `content.mjs`. Edit it there, then rebuild:

```
npm i playwright docx            # once, in this folder
node build-html.mjs              # → proposal.html (explicit US Legal pages, 8.5 × 14 in)
node build-pdf.mjs ../Elpisoft_Pickleball_System_Proposal.pdf   # prints US Legal PDF and reports any page or price-card overflow
node build-md.mjs ../Elpisoft_Pickleball_System_Proposal.md
```

Optional: `node make-images.mjs && node build-docx.mjs out.docx` produces an editable Word version (Arial/Consolas, the brand guide's Office fallback fonts).
Brand assets in `a/` are copies of the official Elpisoft master files.

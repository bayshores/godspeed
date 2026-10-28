// Renders CMU Serif titles to PNGs for the pen.dev landing design (pen.dev
// only loads Google Fonts). Usage: node render-titles.cjs '[["name","Text",76,"#E6E6E6"]]'
const path = require("path");
const root = path.resolve(__dirname, "../..");
const { Resvg } = require(root + "/node_modules/@resvg/resvg-js");
const sharp = require(root + "/node_modules/sharp");
const font = root + "/public/fonts/cmunbx.ttf";
const items = JSON.parse(process.argv[2]);
(async () => {
	for (const [name, text, size, color] of items) {
		const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
		const W = Math.ceil(text.length * size * 0.8) + size * 2;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${size * 2}"><text x="${size / 2}" y="${size * 1.4}" font-family="CMU Serif" font-weight="bold" font-size="${size}" fill="${color || "#E6E6E6"}">${esc}</text></svg>`;
		const png = new Resvg(svg, { font: { fontFiles: [font], loadSystemFonts: false, defaultFontFamily: "CMU Serif" }, fitTo: { mode: "zoom", value: 2 } }).render().asPng();
		const img = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
		await sharp(img.data).toFile(path.join(__dirname, name + ".png"));
		console.log(name, img.info.width / 2, img.info.height / 2);
	}
})();

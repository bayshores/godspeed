//! The plot tool's rules and numbers (Rust only; the window reads the y range from the result's
//! details): every bound a call must keep, its formula lines sampled at 200 x values times 20
//! slider values, its points lines as measured, the y range when the agent leaves it out, the one
//! line the agent is told, and the check that a guess's right option names the drawn value.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text::len16;
use gs_json::{Json, json};

use super::plot_expr::{Expr, parse_expr};

pub const PLOT_TOOL: &str = "plot";

const TITLE_MAX: usize = 60;
const LABEL_MAX: usize = 40;
const X_POINTS: usize = 200;
const SLIDER_POINTS: usize = 20;
/// A line may miss a value at no more than a tenth of its points.
const MOST_POINTS: usize = X_POINTS * SLIDER_POINTS / 10;
/// The chosen y range is refused when the values run this many times wider.
const SPREAD_MAX: f64 = 20.0;
const POINTS_MIN: usize = 2;
const POINTS_MAX: usize = 12;
static NAME: LazyLock<Re> = LazyLock::new(|| Re::new("^[a-z][a-z0-9_]{0,11}$", ""));
static NUMBER: LazyLock<Re> = LazyLock::new(|| Re::new(r"[-\u2212]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-\u2212]?\.\d+", "g"));
const RESERVED: [&str; 12] = ["sin", "cos", "tan", "exp", "ln", "log10", "sqrt", "abs", "min", "max", "pi", "e"];

/// A number, or a string that reads as one (validation converts those).
fn number(v: &Json) -> Option<f64> {
	match v {
		Json::Num(n) if n.is_finite() => Some(*n),
		Json::Str(s) if !s.trim().is_empty() => s.trim().parse::<f64>().ok().filter(|n| n.is_finite()),
		_ => None,
	}
}

/// A short number for the agent: whole when it has 3 digits or more before the point, else 3
/// significant digits, with trailing zeros cut; a million or more, or under 0.0001, in e form.
pub fn short(v: f64) -> String {
	if !v.is_finite() {
		return "none".to_owned();
	}
	if v == 0.0 {
		return "0".to_owned();
	}
	let magnitude = v.abs().log10().floor() as i32;
	if !(-4..6).contains(&magnitude) {
		let text = format!("{v:.2e}");
		let (mantissa, exponent) = text.split_once('e').unwrap_or((&text, "0"));
		return format!("{}e{exponent}", trim_zeros(mantissa));
	}
	let decimals = (2 - magnitude).max(0) as usize;
	let text = trim_zeros(&format!("{v:.decimals$}")).to_owned();
	if text == "-0" { "0".to_owned() } else { text }
}

fn trim_zeros(text: &str) -> &str {
	if text.contains('.') { text.trim_end_matches('0').trim_end_matches('.') } else { text }
}

/// A count with thousands separators: 3,912.
fn count(n: usize) -> String {
	let digits = n.to_string();
	let mut out = String::new();
	for (i, c) in digits.chars().enumerate() {
		if i > 0 && (digits.len() - i).is_multiple_of(3) {
			out.push(',');
		}
		out.push(c);
	}
	out
}

/// The x axis or the slider: a name the formulas use and its range.
pub struct Range {
	pub name: String,
	pub min: f64,
	pub max: f64,
}

impl Range {
	/// The `n` evenly spaced values from min to max, both ends included.
	fn steps(&self, n: usize) -> impl Iterator<Item = f64> + '_ {
		(0..n).map(move |i| self.min + (self.max - self.min) * i as f64 / (n - 1) as f64)
	}

	pub fn holds(&self, v: f64) -> bool {
		(self.min..=self.max).contains(&v)
	}
}

/// A line: a formula in x and the slider, or measured `[x, y]` points by increasing x.
pub enum Shape {
	Formula(Expr),
	Points(Vec<(f64, f64)>),
}

pub struct PlotLine {
	pub label: String,
	pub shape: Shape,
}

/// The slider the formulas read, and where its thumb starts.
pub struct Slider {
	pub range: Range,
	pub start: f64,
}

/// A plot call that keeps every rule, with the y range it draws in. It has a slider when a line
/// is a formula, and only then.
pub struct Plot {
	pub x: Range,
	pub slider: Option<Slider>,
	pub lines: Vec<PlotLine>,
	pub y: (f64, f64),
}

impl Plot {
	/// The line labelled `label`, by index.
	pub fn line(&self, label: &str) -> Option<usize> {
		self.lines.iter().position(|l| l.label == label)
	}

	/// The line's value at `x` with the slider at `slider` (not finite where it has none; a points
	/// line has one only at its own x values). A value under a billionth of the y range is float
	/// noise and reads 0.
	pub fn line_value(&self, line: usize, x: f64, slider: f64) -> f64 {
		let value = match &self.lines[line].shape {
			Shape::Formula(expr) => expr.eval(&[x, slider]),
			Shape::Points(points) => points.iter().find(|p| p.0 == x).map_or(f64::NAN, |p| p.1),
		};
		if value.abs() < 1e-9 * (self.y.1 - self.y.0) { 0.0 } else { value }
	}

	/// The values the agent is told: the formula lines at slider start and x at min, middle and
	/// max; every point of a points line.
	/// `p1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2.`
	/// `p1 drawn. degree = 1, 3, 5, 9: cv_error 0.8, 0.4, 0.3, 0.9.`
	pub fn result_line(&self, id: &str) -> String {
		let xs = [self.x.min, (self.x.min + self.x.max) / 2.0, self.x.max];
		let listed = |values: &mut dyn Iterator<Item = f64>| values.map(short).collect::<Vec<_>>().join(", ");
		let mut out = format!("{id} drawn.");
		let mut formulas_said = false;
		for (i, line) in self.lines.iter().enumerate() {
			match (&line.shape, &self.slider) {
				(Shape::Formula(_), Some(slider)) => {
					if !formulas_said {
						out.push_str(&format!(" At {} {}, {} = {}:", slider.range.name, short(slider.start), self.x.name, listed(&mut xs.iter().copied())));
						formulas_said = true;
					}
					out.push_str(&format!(" {} {}.", line.label, listed(&mut xs.iter().map(|&x| self.line_value(i, x, slider.start)))));
				}
				(Shape::Formula(_), None) => {}
				(Shape::Points(points), _) => {
					out.push_str(&format!(" {} = {}: {} {}.", self.x.name, listed(&mut points.iter().map(|p| p.0)), line.label, listed(&mut points.iter().map(|p| p.1))));
				}
			}
		}
		out
	}
}

/// Collects the problems of one call, each `<path>: <what was wrong>. <one fix>.`
#[derive(Default)]
struct Problems(Vec<String>);

impl Problems {
	fn add(&mut self, line: String) {
		self.0.push(line);
	}

	fn text(&mut self, args: &Json, path: &str, max: usize, required: bool) -> Option<String> {
		let Some(value) = at(args, path).as_str() else {
			self.add(format!("{path}: must be a string."));
			return None;
		};
		let length = len16(value);
		if length > max {
			self.add(format!("{path}: {length} characters, at most {max}."));
		} else if required && value.trim().is_empty() {
			self.add(format!("{path}: is empty."));
		}
		Some(value.to_owned())
	}

	fn number(&mut self, args: &Json, path: &str) -> Option<f64> {
		let value = number(at(args, path));
		if value.is_none() {
			self.add(format!("{path}: must be a number."));
		}
		value
	}

	fn name(&mut self, args: &Json, path: &str) -> Option<String> {
		let name = self.text(args, path, LABEL_MAX, true)?;
		if !NAME.test(&name) {
			self.add(format!("{path}: \"{name}\" must be a lowercase word of at most 12 letters, digits or _, like a or lambda."));
			return None;
		}
		if RESERVED.contains(&name.as_str()) {
			self.add(format!("{path}: \"{name}\" is taken by the formulas. Use another name."));
			return None;
		}
		Some(name)
	}

	/// `path.min` below `path.max`, both numbers.
	fn range(&mut self, args: &Json, path: &str) -> Option<(f64, f64)> {
		let min = self.number(args, &format!("{path}.min"));
		let max = self.number(args, &format!("{path}.max"));
		let (min, max) = (min?, max?);
		if min >= max {
			self.add(format!("{path}.min: must be less than {path}.max."));
			return None;
		}
		if !(max - min).is_finite() {
			self.add(format!("{path}: {} to {} is too wide. Narrow it.", short(min), short(max)));
			return None;
		}
		if narrow(min, max) {
			self.add(format!("{path}: {} to {} is too narrow for numbers this large. Shift it to start near 0 and the formulas with it, like 0 to {}.", short(min), short(max), short(max - min)));
			return None;
		}
		Some((min, max))
	}
}

/// Whether `min..max` is too narrow beside its numbers for the window to tell its ticks apart.
fn narrow(min: f64, max: f64) -> bool {
	max - min < 1e-9 * min.abs().max(max.abs())
}

/// The value at a dotted path; `lines[0]` style steps index arrays.
fn at<'a>(args: &'a Json, path: &str) -> &'a Json {
	path.split('.').fold(args, |v, step| match step.split_once('[') {
		Some((key, index)) => &v[key][index.trim_end_matches(']').parse::<usize>().unwrap_or(usize::MAX)],
		None => &v[step],
	})
}

/// Whether `v` holds `key` with a value.
fn present(v: &Json, key: &str) -> bool {
	v.get(key).is_some_and(|v| !v.is_null())
}

/// Checks a plot call against every rule at once: the bounds, the names, each formula, each
/// points line, that each formula has a value at nine tenths of its points or more, and the y
/// range. The slider and x.name serve the formulas: needed when a line is one, and a slider is
/// refused when none is. All problems in one list, in field order.
pub fn check_plot(args: &Json) -> Result<Plot, Vec<String>> {
	let mut p = Problems::default();
	p.text(args, "title", TITLE_MAX, true);
	let formulas = args["lines"].as_arr().is_none_or(|lines| lines.iter().any(|l| present(l, "expr")));
	for (key, label) in [("x", "x.label"), ("y", "y.label"), ("slider", "slider.name")] {
		if key == "slider" && !formulas {
			if present(args, key) {
				p.add("slider: no line uses it. Leave it out.".to_owned());
			}
		} else if args[key].as_obj().is_none() {
			p.add(format!("{key}: must be an object."));
		} else if key != "slider" {
			p.text(args, label, LABEL_MAX, false);
		}
	}
	let x_name = args["x"].as_obj().filter(|_| formulas || present(&args["x"], "name")).and_then(|_| p.name(args, "x.name"));
	let x_range = args["x"].as_obj().and_then(|_| p.range(args, "x"));
	let y_given = given_y(args, &mut p);
	let slider = args["slider"].as_obj().filter(|_| formulas);
	let slider_name = slider.and_then(|_| p.name(args, "slider.name"));
	let slider_range = slider.and_then(|_| p.range(args, "slider"));
	let start = slider.and_then(|_| p.number(args, "slider.start"));
	if let (Some(start), Some((min, max))) = (start, slider_range)
		&& !(min..=max).contains(&start)
	{
		p.add(format!("slider.start: {} is outside min {} to max {}.", short(start), short(min), short(max)));
	}
	let names_differ = match (&x_name, &slider_name) {
		(Some(x), Some(s)) if x == s => {
			p.add(format!("slider.name: \"{s}\" is also x.name. Use two different names."));
			false
		}
		_ => true,
	};
	let names: Vec<&str> = [x_name.as_deref(), slider_name.as_deref()].into_iter().flatten().collect();
	let lines = read_lines(args, &names, names_differ && names.len() == 2, x_range, &mut p);
	let slider = match (slider_name, slider_range, start) {
		(Some(name), Some((min, max)), Some(start)) => Some(Slider { range: Range { name, min, max }, start }),
		_ => None,
	};
	let (Some((x_min, x_max)), Some(lines), true) = (x_range, lines, p.0.is_empty()) else {
		return Err(p.0);
	};
	// A points plot with no x.name is told about x by its axis title.
	let x_name = x_name.or_else(|| args["x"]["label"].as_str().map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned)).unwrap_or_else(|| "x".to_owned());
	let mut plot = Plot { x: Range { name: x_name, min: x_min, max: x_max }, slider, lines, y: (0.0, 0.0) };
	let mut values = Vec::new();
	for (i, line) in plot.lines.iter().enumerate() {
		match (&line.shape, &plot.slider) {
			(Shape::Formula(expr), Some(slider)) => {
				let samples = sample(&plot.x, &slider.range, expr);
				let missing = samples.iter().filter(|v| !v.is_finite()).count();
				if missing > MOST_POINTS {
					p.add(not_a_number(&plot.x, &slider.range, i, expr, &samples, missing));
				}
				values.extend(samples);
			}
			(Shape::Formula(_), None) => {}
			(Shape::Points(points), _) => values.extend(points.iter().map(|p| p.1)),
		}
	}
	if !p.0.is_empty() {
		return Err(p.0);
	}
	plot.y = match y_given {
		Some(y) => y,
		None => y_range(&values).map_err(|refusal| vec![refusal])?,
	};
	Ok(plot)
}

/// `y.min` and `y.max`: both or neither.
fn given_y(args: &Json, p: &mut Problems) -> Option<(f64, f64)> {
	let y = &args["y"];
	match (y.get("min").is_some_and(|v| !v.is_null()), y.get("max").is_some_and(|v| !v.is_null())) {
		(false, false) => None,
		(true, true) => p.range(args, "y"),
		_ => {
			p.add("y: give both y.min and y.max, or leave both out.".to_owned());
			None
		}
	}
}

/// The lines, each formula parsed when the names are good (`parse`), each points line checked
/// against the x range when it is good.
fn read_lines(args: &Json, names: &[&str], parse: bool, x: Option<(f64, f64)>, p: &mut Problems) -> Option<Vec<PlotLine>> {
	let Some(list) = args["lines"].as_arr() else {
		p.add("lines: must be a list of 1 or 2 lines.".to_owned());
		return None;
	};
	if list.is_empty() || list.len() > 2 {
		p.add(format!("lines: give 1 or 2 lines, got {}.", list.len()));
		return None;
	}
	let mut lines = Vec::new();
	let mut labels: Vec<String> = Vec::new();
	for (i, line) in list.iter().enumerate() {
		let path = format!("lines[{i}]");
		if line.as_obj().is_none() {
			p.add(format!("{path}: must be an object."));
			continue;
		}
		let label = p.text(args, &format!("{path}.label"), LABEL_MAX, true);
		if let Some(label) = &label {
			if labels.contains(label) {
				p.add(format!("{path}.label: \"{label}\" is also lines[0].label. Use two different labels."));
			}
			labels.push(label.clone());
		}
		if !matches!(line.get("hidden"), None | Some(Json::Null | Json::Bool(_))) {
			p.add(format!("{path}.hidden: must be true or false."));
		}
		let label = label.unwrap_or_default();
		match (present(line, "expr"), present(line, "points")) {
			(true, true) => p.add(format!("{path}: has both expr and points. Keep one.")),
			(false, true) => {
				if let Some(points) = read_points(line, &path, x, p) {
					lines.push(PlotLine { label, shape: Shape::Points(points) });
				}
			}
			_ => {
				let Some(src) = p.text(args, &format!("{path}.expr"), usize::MAX, false) else { continue };
				if !parse {
					continue;
				}
				match parse_expr(&src, names) {
					Ok(expr) => lines.push(PlotLine { label, shape: Shape::Formula(expr) }),
					Err(error) => p.add(format!("{path}.expr: {error}")),
				}
			}
		}
	}
	if !list.is_empty() && list.iter().all(|l| l["hidden"] == Json::Bool(true)) {
		p.add("lines: every line is hidden. Leave one shown.".to_owned());
	}
	(lines.len() == list.len()).then_some(lines)
}

/// A points line's 2 to 12 `[x, y]` pairs, by increasing x, each x inside the x range.
fn read_points(line: &Json, path: &str, x: Option<(f64, f64)>, p: &mut Problems) -> Option<Vec<(f64, f64)>> {
	let path = format!("{path}.points");
	let Some(list) = line["points"].as_arr() else {
		p.add(format!("{path}: must be a list of [x, y] pairs."));
		return None;
	};
	if !(POINTS_MIN..=POINTS_MAX).contains(&list.len()) {
		p.add(format!("{path}: give {POINTS_MIN} to {POINTS_MAX} points, got {}.", list.len()));
		return None;
	}
	let before = p.0.len();
	let mut points: Vec<(f64, f64)> = Vec::new();
	for (j, pair) in list.iter().enumerate() {
		let at = format!("{path}[{j}]");
		let Some((px, py)) = pair.as_arr().filter(|pair| pair.len() == 2).and_then(|pair| Some((number(&pair[0])?, number(&pair[1])?))) else {
			p.add(format!("{at}: must be [x, y], two numbers."));
			continue;
		};
		if let Some(&(last, _)) = points.last()
			&& px <= last
		{
			p.add(format!("{at}: x {} comes after x {}. List the points by increasing x, each x once.", short(px), short(last)));
		}
		if let Some((min, max)) = x
			&& !(min..=max).contains(&px)
		{
			p.add(format!("{at}: x {} is outside min {} to max {}. Widen x or leave the point out.", short(px), short(min), short(max)));
		}
		points.push((px, py));
	}
	(p.0.len() == before).then_some(points)
}

/// A formula's values at the 20 slider values (outer) times the 200 x values (inner).
fn sample(x: &Range, slider: &Range, expr: &Expr) -> Vec<f64> {
	slider.steps(SLIDER_POINTS).flat_map(|s| x.steps(X_POINTS).map(move |x| expr.eval(&[x, s])).collect::<Vec<_>>()).collect()
}

fn not_a_number(x_range: &Range, slider: &Range, line: usize, expr: &Expr, values: &[f64], missing: usize) -> String {
	let first = values.iter().position(|v| !v.is_finite()).unwrap_or(0);
	let x = x_range.steps(X_POINTS).nth(first % X_POINTS).unwrap_or(x_range.min);
	let s = slider.steps(SLIDER_POINTS).nth(first / X_POINTS).unwrap_or(slider.min);
	let fault = expr.fault(&[x, s]).unwrap_or(super::plot_expr::Fault::Other);
	format!(
		"lines[{line}].expr: not a number at {} of {} points (first at {} = {}, {} = {}: {}). {}",
		count(missing),
		count(values.len()),
		x_range.name,
		short(x),
		slider.name,
		short(s),
		fault.what(),
		fault.fix()
	)
}

/// The value at quantile `q` of sorted values, nearest rank.
fn quantile(sorted: &[f64], q: f64) -> f64 {
	sorted[((sorted.len() - 1) as f64 * q).round() as usize]
}

/// The y range when the agent gave none: the 2nd to 98th percentile of every finite value over
/// all formula samples and measured points, rounded out to round ticks. Refused, with the line the agent gets,
/// when all values run more than 20 times wider, since a pole or fast growth would then squash
/// the curve flat.
fn y_range(values: &[f64]) -> Result<(f64, f64), String> {
	let mut sorted: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
	if sorted.is_empty() {
		return Ok((-1.0, 1.0));
	}
	sorted.sort_by(f64::total_cmp);
	let (q_lo, q_hi) = (quantile(&sorted, 0.02), quantile(&sorted, 0.98));
	// Values too far apart to round are refused below with their own numbers.
	let (lo, hi) = if (q_hi - q_lo).is_finite() { round_out(q_lo, q_hi) } else { (q_lo, q_hi) };
	let (all_lo, all_hi) = (sorted[0], sorted[sorted.len() - 1]);
	if !(hi - lo).is_finite() || !(all_hi - all_lo).is_finite() || all_hi - all_lo > SPREAD_MAX * (hi - lo) {
		return Err(format!("y: values run from {} to {} but most lie in {} to {}. Give y.min and y.max.", short(all_lo), short(all_hi), short(lo), short(hi)));
	}
	if narrow(lo, hi) {
		return Err(format!("y: the lines run from {} to {}, too narrow for numbers this large. Shift the formulas nearer 0.", short(all_lo), short(all_hi)));
	}
	Ok((lo, hi))
}

/// Widens `lo..hi` to multiples of a 1, 2 or 5 step, about four steps across; a flat range first
/// gets a tenth of its value (or 1) on each side.
fn round_out(lo: f64, hi: f64) -> (f64, f64) {
	let flat = hi - lo <= f64::EPSILON * hi.abs().max(lo.abs());
	let (lo, hi) = if flat {
		let pad = if lo.abs() > 1e-300 { lo.abs() / 10.0 } else { 1.0 };
		(lo - pad, hi + pad)
	} else {
		(lo, hi)
	};
	let raw = (hi - lo) / 4.0;
	if !raw.is_normal() {
		return (lo, hi);
	}
	let power = (raw.log10().floor() as i32).clamp(-300, 308);
	let unit = 10f64.powi(power);
	let step = [1.0, 2.0, 5.0, 10.0].into_iter().map(|m| m * unit).find(|s| *s >= raw).unwrap_or(10.0 * unit);
	let decimals = (-power).max(0) as usize;
	let clean = |v: f64| format!("{v:.decimals$}").parse::<f64>().unwrap_or(v);
	(clean((lo / step).floor() * step), clean((hi / step).ceil() * step))
}

/// The numbers an option's words name: `At 2, the leash's length.` names 2. Thousands commas and
/// a Unicode minus are read too.
fn named_numbers(label: &str) -> Vec<f64> {
	NUMBER.captures_iter(label).iter().filter_map(|m| m.as_string().replace(',', "").replace('\u{2212}', "-").parse::<f64>().ok()).collect()
}

/// `v` rounded to 2 significant figures.
fn two_figures(v: f64) -> f64 {
	if v == 0.0 || !v.is_finite() {
		return v;
	}
	let scale = 10f64.powi(1 - v.abs().log10().floor() as i32);
	(v * scale).round() / scale
}

/// Whether an option's words name `value` to 2 significant figures.
pub fn option_names_value(label: &str, value: f64) -> bool {
	let want = two_figures(value);
	value.is_finite() && named_numbers(label).into_iter().any(|n| (two_figures(n) - want).abs() <= 1e-9 * want.abs().max(1e-300))
}

/// The plot result's `details`: kind and version, the plot's id, its guess and where y runs.
pub fn plot_details(id: &str, on_plot: Json, y: (f64, f64)) -> Json {
	json!({ "part": PLOT_TOOL, "v": 1, "id": id, "onPlot": on_plot, "y": { "min": y.0, "max": y.1 } })
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn leash() -> Json {
		json!({
			"title": "One feature, where the weight ends up",
			"x": { "name": "a", "label": "where the data alone put it, $a$", "min": 0, "max": 10 },
			"y": { "label": "$w$", "min": 0, "max": 5 },
			"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 },
			"lines": [{ "label": "penalty", "expr": "a/(1+lambda)", "hidden": true }, { "label": "leash", "expr": "min(a, 4/(1+lambda))" }],
		})
	}

	fn with(mut args: Json, path: &[&str], value: Json) -> Json {
		let (last, parents) = path.split_last().unwrap();
		let mut at = &mut args;
		for key in parents {
			at = match key.parse::<usize>() {
				Ok(i) => &mut at.as_arr_mut().unwrap()[i],
				Err(_) => at.as_obj_mut().unwrap().get_mut(key).unwrap(),
			};
		}
		at.as_obj_mut().unwrap().insert(*last, value);
		args
	}

	fn problems(args: Json) -> Vec<String> {
		check_plot(&args).err().unwrap_or_default()
	}

	#[test]
	fn the_leash_plot_passes_and_says_its_values() {
		let plot = check_plot(&leash()).unwrap();
		assert_eq!(plot.result_line("p1"), "p1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2.");
		assert_eq!(plot.y, (0.0, 5.0), "the agent's own range");
		assert_eq!(plot.line_value(plot.line("penalty").unwrap(), 8.0, 1.0), 4.0);
		assert_eq!(plot.line_value(plot.line("leash").unwrap(), 8.0, 1.0), 2.0);
		assert_eq!(plot.line("penalty curve"), None);
	}

	#[test]
	fn every_bound_comes_back_at_once() {
		let args = json!({
			"title": "x".repeat(74),
			"x": { "name": "a", "label": "a", "min": 10, "max": 0 },
			"y": { "label": "w", "min": 1 },
			"slider": { "name": "a", "min": 0.5, "max": 4, "start": 6 },
			"lines": [{ "label": "one", "expr": "a" }, { "label": "two", "expr": "a" }, { "label": "three", "expr": "a" }],
		});
		assert_eq!(
			problems(args),
			[
				"title: 74 characters, at most 60.",
				"x.min: must be less than x.max.",
				"y: give both y.min and y.max, or leave both out.",
				"slider.start: 6 is outside min 0.5 to max 4.",
				"slider.name: \"a\" is also x.name. Use two different names.",
				"lines: give 1 or 2 lines, got 3.",
			]
		);
	}

	#[test]
	fn names_labels_and_formulas_are_checked() {
		let args = with(with(with(leash(), &["x", "name"], json!("Alpha")), &["slider", "name"], json!("pi")), &["lines", "1", "label"], json!("penalty"));
		assert_eq!(
			problems(args),
			[
				"x.name: \"Alpha\" must be a lowercase word of at most 12 letters, digits or _, like a or lambda.",
				"slider.name: \"pi\" is taken by the formulas. Use another name.",
				"lines[1].label: \"penalty\" is also lines[0].label. Use two different labels.",
			]
		);
		let args = with(with(leash(), &["lines", "0", "expr"], json!("2a")), &["lines", "1", "expr"], json!("a/(1+lamda)"));
		assert_eq!(problems(args), ["lines[0].expr: write * between \"2\" and \"a\".", "lines[1].expr: unknown name \"lamda\". Use only a, lambda, pi, e."]);
		let hidden = with(leash(), &["lines", "1", "hidden"], json!(true));
		assert_eq!(problems(hidden), ["lines: every line is hidden. Leave one shown."]);
		assert_eq!(problems(json!({})), ["title: must be a string.", "x: must be an object.", "y: must be an object.", "slider: must be an object.", "lines: must be a list of 1 or 2 lines."]);
		let loose = with(with(leash(), &["x", "max"], json!("10")), &["lines", "0", "hidden"], json!("yes"));
		assert_eq!(problems(loose), ["lines[0].hidden: must be true or false."], "a number may come as text");
		let wide = with(leash(), &["x"], json!({ "name": "a", "label": "a", "min": -1.7e308, "max": 1.7e308 }));
		assert_eq!(problems(wide), ["x: -1.7e308 to 1.7e308 is too wide. Narrow it."]);
	}

	/// The window could not tell such a range's ticks apart.
	#[test]
	fn a_range_too_narrow_for_its_numbers_is_refused() {
		let far = |range: Json| json!({ "name": "s", "label": "s", "min": range[0].clone(), "max": range[1].clone(), "start": range[0].clone() });
		let args = json!({ "title": "t", "x": { "name": "a", "label": "a", "min": 1e18, "max": 1e18 + 256.0 }, "y": { "label": "y", "min": 1e18, "max": 1.000_000_000_000_000_3e18 }, "slider": far(json!([-1e17, -1e17 + 96.0])), "lines": [{ "label": "f", "expr": "a - 1000000000000000000" }] });
		let fix = "is too narrow for numbers this large. Shift it to start near 0 and the formulas with it, like 0 to";
		assert_eq!(problems(args), [format!("x: 1e18 to 1e18 {fix} 256."), format!("y: 1e18 to 1e18 {fix} 256."), format!("slider: -1e17 to -1e17 {fix} 96.")]);
		let lone = json!({ "title": "t", "x": { "name": "a", "label": "a", "min": 0, "max": 10 }, "y": { "label": "y" }, "slider": far(json!([0, 1])), "lines": [{ "label": "f", "expr": "a*100 + 1000000000000000000" }] });
		assert_eq!(problems(lone), ["y: the lines run from 1e18 to 1e18, too narrow for numbers this large. Shift the formulas nearer 0."]);
		let fine = with(leash(), &["x"], json!({ "name": "a", "label": "a", "min": 1e6, "max": 1e6 + 1.0 }));
		assert!(check_plot(&fine).is_ok(), "a million and one is fine");
	}

	#[test]
	fn a_line_with_no_value_at_most_points_is_refused_and_one_gap_is_fine() {
		let gap = with(with(leash(), &["lines", "0", "expr"], json!("1/a")), &["y"], json!({ "label": "w" }));
		assert!(check_plot(&gap).is_ok(), "1/a misses only a = 0");
		let args = with(leash(), &["lines", "0", "expr"], json!("1/(a-a)"));
		assert_eq!(problems(args), ["lines[0].expr: not a number at 4,000 of 4,000 points (first at a = 0, lambda = 0.5: division by zero). Check the denominator."]);
		let roots = with(with(leash(), &["lines", "1", "expr"], json!("sqrt(a - 9)")), &["x", "min"], json!(-10));
		assert_eq!(problems(roots), ["lines[1].expr: not a number at 3,800 of 4,000 points (first at a = -10, lambda = 0.5: the square root of a negative number). Check what sqrt is taken of."]);
	}

	/// The four formulas of the design's pole cases: the full range is refused when it runs more
	/// than 20 times wider than most values; a normal line gets a round range.
	#[test]
	fn poles_and_fast_growth_need_a_range_from_the_agent() {
		let lone = |expr: &str, x_max: f64| {
			let args = json!({ "title": "t", "x": { "name": "a", "label": "a", "min": 0, "max": x_max }, "y": { "label": "y" }, "slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 }, "lines": [{ "label": "f", "expr": expr }] });
			check_plot(&args).map(|plot| plot.y)
		};
		assert_eq!(lone("1/(a-lambda)", 10.0).unwrap_err(), ["y: values run from -74.1 to 398 but most lie in -5 to 5. Give y.min and y.max."]);
		assert_eq!(lone("exp(lambda*a)", 10.0).unwrap_err(), ["y: values run from 1 to 2.35e17 but most lie in 0 to 4e14. Give y.min and y.max."]);
		assert_eq!(lone("tan(a)", 3.0).unwrap(), (-20.0, 20.0), "its pole is a few points of 200: drawn, clipped");
		assert_eq!(lone("a/(1+lambda)", 10.0).unwrap(), (0.0, 6.0));
		assert_eq!(lone("2", 10.0).unwrap(), (1.8, 2.2), "a flat line gets room around it");
		assert_eq!(lone("0.001*a", 10.0).unwrap(), (0.0, 0.01));
		assert_eq!(round_out(0.0, 0.0), (-1.0, 1.0));
		assert_eq!(round_out(5e-324, 5e-324), (-1.0, 1.0), "the smallest numbers never overflow the step");
		let huge = json!({ "title": "t", "x": { "name": "a", "label": "a", "min": 700, "max": 709 }, "y": { "label": "y" }, "slider": { "name": "s", "min": 0, "max": 1, "start": 0 }, "lines": [{ "label": "up", "expr": "1.5*exp(a)" }, { "label": "down", "expr": "-1.5*exp(a)" }] });
		assert_eq!(problems(huge), ["y: values run from -1.23e308 to 1.23e308 but most lie in -1e308 to 1e308. Give y.min and y.max."], "never a range that is not a number");
	}

	fn cv_points() -> Json {
		json!({
			"title": "Cross-validation error by degree",
			"x": { "name": "degree", "label": "polynomial degree", "min": 0, "max": 10 },
			"y": { "label": "CV error" },
			"lines": [{ "label": "cv_error", "points": [[1, 0.8], [3, 0.4], ["5", "0.3"], [9, 0.9]] }],
		})
	}

	/// A call stored before points existed checks, says and stores exactly as it did.
	#[test]
	fn a_formula_plot_from_before_points_checks_says_and_stores_as_before() {
		let plot = check_plot(&leash()).unwrap();
		assert_eq!(plot.result_line("p1"), "p1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2.");
		assert_eq!(plot.y, (0.0, 5.0));
		let slider = plot.slider.as_ref().unwrap();
		assert_eq!((slider.range.name.as_str(), slider.range.min, slider.range.max, slider.start), ("lambda", 0.5, 4.0, 1.0));
		let picked = check_plot(&with(leash(), &["y"], json!({ "label": "w" }))).unwrap();
		assert_eq!(picked.y, (0.0, 6.0), "the y range it picks");
		assert_eq!(problems(with(leash(), &["slider"], json!(null))), ["slider: must be an object."]);
	}

	#[test]
	fn a_points_line_passes_and_says_every_point() {
		let plot = check_plot(&cv_points()).unwrap();
		assert_eq!(plot.result_line("p1"), "p1 drawn. degree = 1, 3, 5, 9: cv_error 0.8, 0.4, 0.3, 0.9.");
		assert!(plot.slider.is_none());
		assert_eq!(plot.y, (0.2, 1.0), "picked from the points");
		assert_eq!(plot.line_value(0, 5.0, f64::NAN), 0.3);
		assert!(plot.line_value(0, 4.0, f64::NAN).is_nan(), "no value between points");
		let unnamed = with(cv_points(), &["x"], json!({ "label": "degree", "min": 0, "max": 10 }));
		assert_eq!(check_plot(&unnamed).unwrap().result_line("p2"), "p2 drawn. degree = 1, 3, 5, 9: cv_error 0.8, 0.4, 0.3, 0.9.", "no x.name: the axis title");
	}

	#[test]
	fn a_formula_and_points_share_a_plot() {
		let mixed = with(leash(), &["lines"], json!([{ "label": "model", "expr": "a/(1+lambda)" }, { "label": "data", "points": [[2, 1.2], [6, 2.7], [10, 5.4]], "hidden": true }]));
		let plot = check_plot(&with(mixed, &["y"], json!({ "label": "w" }))).unwrap();
		assert_eq!(plot.result_line("p1"), "p1 drawn. At lambda 1, a = 0, 5, 10: model 0, 2.5, 5. a = 2, 6, 10: data 1.2, 2.7, 5.4.");
		assert_eq!(plot.y, (0.0, 6.0), "from the formula's values and the points together");
	}

	#[test]
	fn every_points_rule_comes_back_at_once() {
		let broken = with(
			with(cv_points(), &["slider"], json!({ "name": "lambda", "min": 0, "max": 1, "start": 0 })),
			&["lines"],
			json!([{ "label": "one", "points": [[1, 2], [1, 3], [12, 1], [4], [5, "high"]] }, { "label": "two", "points": [[1, 2]] }]),
		);
		assert_eq!(
			problems(broken),
			[
				"slider: no line uses it. Leave it out.",
				"lines[0].points[1]: x 1 comes after x 1. List the points by increasing x, each x once.",
				"lines[0].points[2]: x 12 is outside min 0 to max 10. Widen x or leave the point out.",
				"lines[0].points[3]: must be [x, y], two numbers.",
				"lines[0].points[4]: must be [x, y], two numbers.",
				"lines[1].points: give 2 to 12 points, got 1.",
			]
		);
		let both = with(cv_points(), &["lines"], json!([{ "label": "one", "expr": "degree", "points": [[1, 2], [3, 4]] }, { "label": "two" }]));
		assert_eq!(problems(both), ["slider: must be an object.", "lines[0]: has both expr and points. Keep one.", "lines[1].expr: must be a string."], "a formula needs the slider");
		let too_many = with(cv_points(), &["lines", "0", "points"], json!((0..13).map(|i| json!([i as f64 * 0.5, 1])).collect::<Vec<_>>()));
		assert_eq!(problems(too_many), ["lines[0].points: give 2 to 12 points, got 13."]);
		assert_eq!(problems(with(cv_points(), &["lines", "0", "points"], json!("[[1, 2], [3, 4]]"))), ["lines[0].points: must be a list of [x, y] pairs."]);
		assert_eq!(problems(with(cv_points(), &["lines", "0", "hidden"], json!(true))), ["lines: every line is hidden. Leave one shown."]);
		assert_eq!(problems(with(cv_points(), &["x", "name"], json!("Degree"))), ["x.name: \"Degree\" must be a lowercase word of at most 12 letters, digits or _, like a or lambda."], "a name sent is still checked");
	}

	/// `0.1*3 - 0.3` is 5.55e-17 in floats, which no option's words could name.
	#[test]
	fn a_value_that_is_zero_up_to_rounding_is_zero() {
		let plot = check_plot(&with(with(leash(), &["lines", "0", "expr"], json!("a*0.1 - 0.3")), &["lines", "1", "expr"], json!("sin(a)"))).unwrap();
		assert_eq!(plot.line_value(0, 3.0, 1.0), 0.0);
		assert_eq!(plot.line_value(1, std::f64::consts::PI, 1.0), 0.0);
		assert!(option_names_value("It crosses 0.", plot.line_value(0, 3.0, 1.0)));
		assert!(plot.line_value(0, 3.001, 1.0) > 0.0, "a small value the plot can show stays");
	}

	#[test]
	fn an_option_names_the_value_to_two_figures() {
		assert!(option_names_value("At 2, the leash's length.", 2.0));
		assert!(option_names_value("At 4.", 4.0));
		assert!(!option_names_value("At 3.", 4.0));
		assert!(option_names_value("About 3.14", std::f64::consts::PI));
		assert!(option_names_value("It reaches 1,004.", 1004.0));
		assert!(option_names_value("\u{2212}0.25 or so", -0.251));
		assert!(!option_names_value("No number here.", 4.0));
		assert!(!option_names_value("At 4.", f64::NAN));
		assert!(option_names_value("0", 0.0));
	}

	#[test]
	fn numbers_read_short() {
		let shown: Vec<String> = [0.0, 2.5, -74.33, 398.02, 0.050_251, 1234.6, 2.353_852_668_37e17, 1e-5, -0.0001, f64::NAN].map(short).to_vec();
		assert_eq!(shown, ["0", "2.5", "-74.3", "398", "0.0503", "1235", "2.35e17", "1e-5", "-0.0001", "none"]);
		assert_eq!(count(3912), "3,912");
		assert_eq!(count(400), "400");
		assert_eq!(stringify(&plot_details("p1", json!({ "toolCallId": "q1", "value": 4 }), (0.0, 5.0))), r#"{"part":"plot","v":1,"id":"p1","onPlot":{"toolCallId":"q1","value":4},"y":{"min":0,"max":5}}"#);
	}
}

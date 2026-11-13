//! Plot formulas (src/shared/core/plot-expr.ts; both replay tests/golden/plot_expr.json): the
//! one plain-math grammar a teacher writes plot lines in. Numbers, the x and slider names, pi, e,
//! the operators `+ - * / ^`, brackets, sin cos tan exp ln log10 sqrt abs (one argument), min max
//! (two). No implicit multiplication. Nothing the agent writes runs as code: names are matched
//! against fixed lists, and length and nesting are capped, so parsing and evaluating are bounded
//! on any input. `Expr::fault` (Rust only) says why a value is not a number.

use std::f64::consts::{E, PI};

use gs_base::text::len16;

const MAX_LENGTH: usize = 200;
const MAX_DEPTH: usize = 32;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Op {
	Add,
	Sub,
	Mul,
	Div,
	Pow,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Func {
	Sin,
	Cos,
	Tan,
	Exp,
	Ln,
	Log10,
	Sqrt,
	Abs,
	Min,
	Max,
}

impl Func {
	fn named(name: &str) -> Option<Func> {
		Some(match name {
			"sin" => Func::Sin,
			"cos" => Func::Cos,
			"tan" => Func::Tan,
			"exp" => Func::Exp,
			"ln" => Func::Ln,
			"log10" => Func::Log10,
			"sqrt" => Func::Sqrt,
			"abs" => Func::Abs,
			"min" => Func::Min,
			"max" => Func::Max,
			_ => return None,
		})
	}

	fn arity(self) -> usize {
		if matches!(self, Func::Min | Func::Max) { 2 } else { 1 }
	}

	/// JavaScript's `Math` functions: `min` and `max` give NaN when either side is.
	fn run(self, a: f64, b: f64) -> f64 {
		match self {
			Func::Sin => a.sin(),
			Func::Cos => a.cos(),
			Func::Tan => a.tan(),
			Func::Exp => a.exp(),
			Func::Ln => a.ln(),
			Func::Log10 => a.log10(),
			Func::Sqrt => a.sqrt(),
			Func::Abs => a.abs(),
			Func::Min if a.is_nan() || b.is_nan() => f64::NAN,
			Func::Max if a.is_nan() || b.is_nan() => f64::NAN,
			Func::Min => a.min(b),
			Func::Max => a.max(b),
		}
	}
}

/// JavaScript's `a ** b`: a NaN power, or ±1 to an infinite power, is NaN (Rust's gives 1).
fn js_pow(a: f64, b: f64) -> f64 {
	if b.is_nan() || (a.abs() == 1.0 && b.is_infinite()) { f64::NAN } else { a.powf(b) }
}

/// A parsed formula. `Var(i)` is the i-th name the formula was parsed with.
#[derive(Clone, PartialEq, Debug)]
pub enum Expr {
	Num(f64),
	Var(usize),
	Neg(Box<Expr>),
	Op(Op, Box<Expr>, Box<Expr>),
	Call(Func, Vec<Expr>),
}

/// Why a value is not a number: the first operation that made one from numbers.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fault {
	DivisionByZero,
	Log,
	Sqrt,
	FractionalPower,
	TooLarge,
	Other,
}

impl Fault {
	/// What happened, in a few words.
	pub fn what(self) -> &'static str {
		match self {
			Fault::DivisionByZero => "division by zero",
			Fault::Log => "a log of 0 or less",
			Fault::Sqrt => "the square root of a negative number",
			Fault::FractionalPower => "a negative number to a fractional power",
			Fault::TooLarge => "too large",
			Fault::Other => "not a number",
		}
	}

	/// The one fix to try.
	pub fn fix(self) -> &'static str {
		match self {
			Fault::DivisionByZero => "Check the denominator.",
			Fault::Log => "Check what the log is taken of.",
			Fault::Sqrt => "Check what sqrt is taken of.",
			Fault::FractionalPower => "Check the power.",
			Fault::TooLarge => "Narrow the x or slider range.",
			Fault::Other => "Check the formula.",
		}
	}
}

impl Expr {
	/// The formula's value with `values[i]` for its i-th name (NaN when missing). Not finite where
	/// the math is (1/0, ln(0), sqrt(-1)).
	pub fn eval(&self, values: &[f64]) -> f64 {
		match self {
			Expr::Num(v) => *v,
			Expr::Var(i) => values.get(*i).copied().unwrap_or(f64::NAN),
			Expr::Neg(arg) => -arg.eval(values),
			Expr::Op(op, left, right) => apply(*op, left.eval(values), right.eval(values)),
			Expr::Call(func, args) => {
				let a = args.first().map_or(f64::NAN, |a| a.eval(values));
				let b = args.get(1).map_or(f64::NAN, |b| b.eval(values));
				func.run(a, b)
			}
		}
	}

	/// Why the value at `values` is not a number; none when it is one.
	pub fn fault(&self, values: &[f64]) -> Option<Fault> {
		self.traced(values).1
	}

	fn traced(&self, values: &[f64]) -> (f64, Option<Fault>) {
		let (inputs, value, own) = match self {
			Expr::Num(_) | Expr::Var(_) => {
				// A name with no value is its own fault.
				let value = self.eval(values);
				return (value, (!value.is_finite()).then_some(Fault::Other));
			}
			Expr::Neg(arg) => {
				let (a, fault) = arg.traced(values);
				if fault.is_some() {
					return (-a, fault);
				}
				(vec![a], -a, Fault::Other)
			}
			Expr::Op(op, left, right) => {
				let (a, fault) = left.traced(values);
				if fault.is_some() {
					return (f64::NAN, fault);
				}
				let (b, fault) = right.traced(values);
				if fault.is_some() {
					return (f64::NAN, fault);
				}
				let own = match op {
					Op::Div if b == 0.0 => Fault::DivisionByZero,
					Op::Pow if a < 0.0 && b.fract() != 0.0 => Fault::FractionalPower,
					_ => Fault::TooLarge,
				};
				(vec![a, b], apply(*op, a, b), own)
			}
			Expr::Call(func, args) => {
				let mut inputs = Vec::new();
				for arg in args {
					let (a, fault) = arg.traced(values);
					if fault.is_some() {
						return (f64::NAN, fault);
					}
					inputs.push(a);
				}
				let a = inputs.first().copied().unwrap_or(f64::NAN);
				let own = match func {
					Func::Ln | Func::Log10 if a <= 0.0 => Fault::Log,
					Func::Sqrt if a < 0.0 => Fault::Sqrt,
					Func::Exp => Fault::TooLarge,
					_ => Fault::Other,
				};
				let value = func.run(a, inputs.get(1).copied().unwrap_or(f64::NAN));
				(inputs, value, own)
			}
		};
		if value.is_finite() || !inputs.iter().all(|v| v.is_finite()) {
			return (value, None);
		}
		(value, Some(if own == Fault::TooLarge && value.is_nan() { Fault::Other } else { own }))
	}
}

fn apply(op: Op, a: f64, b: f64) -> f64 {
	match op {
		Op::Add => a + b,
		Op::Sub => a - b,
		Op::Mul => a * b,
		Op::Div => a / b,
		Op::Pow => js_pow(a, b),
	}
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
	Num,
	Name,
	Op,
}

struct Token {
	kind: Kind,
	text: String,
}

const OPERATORS: &str = "+-*/^(),";

fn is_name_start(c: char) -> bool {
	c.is_ascii_alphabetic() || c == '_'
}

/// The formula's tokens, or the error for a character the grammar has no use for.
fn lex(src: &str) -> Result<Vec<Token>, String> {
	let chars: Vec<char> = src.chars().collect();
	let digit = |i: usize| chars.get(i).is_some_and(char::is_ascii_digit);
	let mut out = Vec::new();
	let mut i = 0;
	while i < chars.len() {
		let c = chars[i];
		if matches!(c, ' ' | '\t' | '\n' | '\r') {
			i += 1;
			continue;
		}
		let mut j = i;
		let kind = if digit(i) || (c == '.' && digit(i + 1)) {
			while digit(j) {
				j += 1;
			}
			if chars.get(j) == Some(&'.') && digit(j + 1) {
				j += 1;
				while digit(j) {
					j += 1;
				}
			}
			Kind::Num
		} else if is_name_start(c) {
			while chars.get(j).is_some_and(|&c| is_name_start(c) || c.is_ascii_digit()) {
				j += 1;
			}
			Kind::Name
		} else if OPERATORS.contains(c) {
			j += 1;
			Kind::Op
		} else {
			return Err(format!("\"{c}\" is not allowed. Use numbers, names, + - * / ^ and brackets."));
		};
		out.push(Token { kind, text: chars[i..j].iter().collect() });
		i = j;
	}
	Ok(out)
}

struct Parser<'a> {
	tokens: Vec<Token>,
	pos: usize,
	names: &'a [&'a str],
}

impl Parser<'_> {
	fn peek(&self) -> Option<&Token> {
		self.tokens.get(self.pos)
	}

	fn at_op(&self, ops: &str) -> bool {
		self.peek().is_some_and(|t| t.kind == Kind::Op && ops.contains(t.text.as_str()))
	}

	fn unexpected(text: &str) -> String {
		if text == ")" || text == "," { format!("unexpected \"{text}\". Check the brackets.") } else { format!("unexpected \"{text}\". Put a number or name before it.") }
	}

	fn deep(depth: usize) -> Result<(), String> {
		if depth > MAX_DEPTH { Err(format!("nested more than {MAX_DEPTH} deep. Write it more simply.")) } else { Ok(()) }
	}

	fn close(&mut self) -> Result<(), String> {
		match self.peek() {
			None => Err("ends too early. Check the brackets.".to_owned()),
			Some(t) if t.kind == Kind::Op && t.text == ")" => {
				self.pos += 1;
				Ok(())
			}
			Some(t) => Err(Self::unexpected(&t.text)),
		}
	}

	fn sum(&mut self, depth: usize) -> Result<Expr, String> {
		Self::deep(depth)?;
		let mut left = self.product(depth)?;
		while self.at_op("+-") {
			let op = if self.tokens[self.pos].text == "+" { Op::Add } else { Op::Sub };
			self.pos += 1;
			left = Expr::Op(op, Box::new(left), Box::new(self.product(depth)?));
		}
		Ok(left)
	}

	fn product(&mut self, depth: usize) -> Result<Expr, String> {
		let mut left = self.operand(depth)?;
		while self.at_op("*/") {
			let op = if self.tokens[self.pos].text == "*" { Op::Mul } else { Op::Div };
			self.pos += 1;
			left = Expr::Op(op, Box::new(left), Box::new(self.operand(depth)?));
		}
		Ok(left)
	}

	/// One factor; a number, name or bracket right after it is a missing *.
	fn operand(&mut self, depth: usize) -> Result<Expr, String> {
		let value = self.unary(depth)?;
		if let Some(next) = self.peek()
			&& (next.kind != Kind::Op || next.text == "(")
		{
			return Err(format!("write * between \"{}\" and \"{}\".", self.tokens[self.pos - 1].text, next.text));
		}
		Ok(value)
	}

	/// A sign binds looser than ^, so -a^2 is -(a^2); ^ groups to the right.
	fn unary(&mut self, depth: usize) -> Result<Expr, String> {
		Self::deep(depth)?;
		if self.at_op("-+") {
			let minus = self.tokens[self.pos].text == "-";
			self.pos += 1;
			let arg = self.unary(depth + 1)?;
			return Ok(if minus { Expr::Neg(Box::new(arg)) } else { arg });
		}
		let base = self.primary(depth)?;
		if !self.at_op("^") {
			return Ok(base);
		}
		self.pos += 1;
		Ok(Expr::Op(Op::Pow, Box::new(base), Box::new(self.unary(depth + 1)?)))
	}

	fn primary(&mut self, depth: usize) -> Result<Expr, String> {
		let Some(t) = self.peek() else { return Err("ends too early. Check the brackets.".to_owned()) };
		let (kind, text) = (t.kind, t.text.clone());
		match kind {
			Kind::Num => {
				self.pos += 1;
				Ok(Expr::Num(text.parse().unwrap_or(f64::NAN)))
			}
			Kind::Name => {
				self.pos += 1;
				if let Some(func) = Func::named(&text) {
					return self.call(func, &text, depth);
				}
				if text == "pi" {
					return Ok(Expr::Num(PI));
				}
				if text == "e" {
					return Ok(Expr::Num(E));
				}
				if let Some(i) = self.names.iter().position(|n| *n == text) {
					return Ok(Expr::Var(i));
				}
				let mut known: Vec<&str> = self.names.to_vec();
				known.extend(["pi", "e"]);
				Err(format!("unknown name \"{text}\". Use only {}.", known.join(", ")))
			}
			Kind::Op if text == "(" => {
				self.pos += 1;
				let arg = self.sum(depth + 1)?;
				self.close()?;
				Ok(arg)
			}
			Kind::Op => Err(Self::unexpected(&text)),
		}
	}

	fn call(&mut self, func: Func, name: &str, depth: usize) -> Result<Expr, String> {
		if !self.at_op("(") {
			return Err(format!("{name} needs brackets around what it takes, like {name}({}).", self.names.first().copied().unwrap_or("x")));
		}
		self.pos += 1;
		let mut args = Vec::new();
		if !self.at_op(")") {
			args.push(self.sum(depth + 1)?);
			while self.at_op(",") {
				self.pos += 1;
				args.push(self.sum(depth + 1)?);
			}
		}
		self.close()?;
		let arity = func.arity();
		if args.len() != arity {
			return Err(format!("{name} takes {arity} argument{}, got {}.", if arity == 1 { "" } else { "s" }, args.len()));
		}
		Ok(Expr::Call(func, args))
	}
}

/// Parses one formula whose variables are `names` (the x name, then the slider's). The error is
/// one line without its path, like `unknown name "lamda". Use only a, lambda, pi, e.`
pub fn parse_expr(src: &str, names: &[&str]) -> Result<Expr, String> {
	if len16(src) > MAX_LENGTH {
		return Err(format!("longer than {MAX_LENGTH} characters."));
	}
	let tokens = lex(src)?;
	if tokens.is_empty() {
		return Err("is empty. Write the line's formula.".to_owned());
	}
	let mut parser = Parser { tokens, pos: 0, names };
	let expr = parser.sum(0)?;
	match parser.peek() {
		Some(rest) => Err(Parser::unexpected(&rest.text)),
		None => Ok(expr),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn value(src: &str, at: [f64; 2]) -> f64 {
		parse_expr(src, &["a", "lambda"]).unwrap().eval(&at)
	}

	fn fault(src: &str, at: [f64; 2]) -> Option<Fault> {
		parse_expr(src, &["a", "lambda"]).unwrap().fault(&at)
	}

	#[test]
	fn powers_follow_javascript() {
		assert!(value("1^(a/0)", [0.0, 0.0]).is_nan());
		assert!(value("(-1)^(1/a)", [0.0, 0.0]).is_nan());
		assert_eq!(value("2^-1", [0.0, 0.0]), 0.5);
		assert!(value("min(a, 0/0)", [1.0, 0.0]).is_nan());
	}

	#[test]
	fn a_fault_names_the_first_operation_that_lost_the_number() {
		assert_eq!(fault("1/(a-lambda)", [1.0, 1.0]), Some(Fault::DivisionByZero));
		assert_eq!(fault("ln(a) + 1", [0.0, 1.0]), Some(Fault::Log));
		assert_eq!(fault("log10(-a)", [2.0, 1.0]), Some(Fault::Log));
		assert_eq!(fault("2 * sqrt(a)", [-1.0, 1.0]), Some(Fault::Sqrt));
		assert_eq!(fault("a^(1/3)", [-8.0, 1.0]), Some(Fault::FractionalPower));
		assert_eq!(fault("exp(lambda*a)", [1000.0, 1.0]), Some(Fault::TooLarge));
		assert_eq!(fault("a^lambda", [10.0, 400.0]), Some(Fault::TooLarge));
		assert_eq!(fault("exp(a) - exp(a)", [1000.0, 1.0]), Some(Fault::TooLarge));
		assert_eq!(fault("a/2", [1.0, 1.0]), None);
		assert_eq!(fault("1/a", [-0.0, 1.0]), Some(Fault::DivisionByZero));
	}

	#[test]
	fn hostile_input_is_bounded() {
		let deep = format!("{}a{}", "(".repeat(33), ")".repeat(33));
		assert_eq!(deep.len(), 67);
		assert_eq!(parse_expr(&deep, &["a"]).unwrap_err(), "nested more than 32 deep. Write it more simply.");
		assert!(parse_expr(&format!("{}a{}", "(".repeat(32), ")".repeat(32)), &["a"]).is_ok());
		assert_eq!(parse_expr(&"-".repeat(199), &["a"]).unwrap_err(), "nested more than 32 deep. Write it more simply.");
		assert_eq!(parse_expr(&"(".repeat(200), &["a"]).unwrap_err(), "nested more than 32 deep. Write it more simply.");
		assert_eq!(parse_expr(&"9".repeat(200), &["a"]).unwrap().eval(&[0.0]), 1e200);
	}
}

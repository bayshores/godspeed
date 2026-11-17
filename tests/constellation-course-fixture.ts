/**
 * A made-up intro C course for the Graph picture's near tests: real fact
 * names and one-sentence statements, so name placement meets real widths.
 * Deterministic.
 */
import { rampColor, tally, topicStatus, type AnswerOutcome, type AnswerRef, type FactProgress, type TopicLink, type TopicProgress } from "../src/shared/core/index.ts";
import { rng, type Space } from "./constellation-fixture.ts";

/** Each topic: name, share of facts answered, how well they go (0 to 1), and "fact name|statement" lines. */
const COURSE: [string, number, number, string[]][] = [
	["Terminal and compiling", 0.8, 0.85, [
		"gcc compiles C|Running gcc on a .c file turns the source into a program the machine can run.",
		"Output name flag|The -o flag names the program gcc writes, so gcc main.c -o main makes main.",
		"Running a program|A program in the current folder runs with ./ before its name.",
		"Warnings flag|The -Wall flag asks gcc to warn about code that compiles but is likely wrong.",
		"Errors stop the build|When gcc finds an error it writes no program at all.",
		"Preprocessor|Lines starting with # are handled by the preprocessor before the compiler sees the code.",
		"Include directive|#include copies a header file's text into the source at that line.",
		"Header files|A header file declares functions so other files can call them.",
		"Object files|The -c flag compiles a file to an object file without linking it.",
		"Linking|The linker joins object files and libraries into one program.",
		"Exit status|The value main returns becomes the program's exit status, and 0 means success.",
		"Make rebuilds what changed|make rebuilds only the targets whose sources are newer than them.",
		"Debug symbols flag|The -g flag keeps names and line numbers in the program for the debugger.",
	]],
	["Variables and types", 0.85, 0.75, [
		"Declaring a variable|A variable must be declared with its type before it is used.",
		"int size|An int is usually 4 bytes and holds whole numbers from about minus 2 billion to 2 billion.",
		"char is a small integer|A char is one byte and stores a character as its number code.",
		"Floating point types|float and double store numbers with fractions, and double has about twice the precision.",
		"Uninitialized locals|A local variable that is never set holds whatever value was left in that memory.",
		"sizeof operator|sizeof gives the number of bytes a type or variable takes.",
		"Signed and unsigned|An unsigned type has no negative values and uses that room for larger positives.",
		"Integer overflow|Going past the largest signed int is undefined behavior in C.",
		"Unsigned wraparound|Unsigned arithmetic wraps around to 0 after the largest value.",
		"Integer division|Dividing two ints drops the fraction, so 7 / 2 is 3.",
		"Implicit conversion|In a mixed expression the narrower type is converted to the wider one first.",
		"Casts|A cast like (double)x converts a value to another type on purpose.",
		"Constants with const|A const variable cannot be changed after it is set.",
		"Character literals|A character in single quotes, like 'A', is an int value of its code.",
		"Scope of a variable|A variable declared inside braces exists only until the closing brace.",
		"Global variables|A variable declared outside all functions lives for the whole run of the program.",
	]],
	["Operators", 0.7, 0.65, [
		"Modulo operator|a % b gives the remainder after dividing a by b.",
		"Increment operators|x++ gives the old value and then adds 1, while ++x adds 1 first.",
		"Compound assignment|x += 3 is short for x = x + 3.",
		"Assignment is an expression|An assignment has a value, so a = b = 0 sets both to 0.",
		"Equality versus assignment|Writing = where == was meant assigns instead of comparing.",
		"Logical AND and OR|&& and || give 1 for true and 0 for false.",
		"Short-circuit evaluation|&& stops at the first false operand and || stops at the first true one.",
		"Truth in C|Any nonzero value counts as true and 0 counts as false.",
		"Operator precedence|Multiplication binds tighter than addition, so 2 + 3 * 4 is 14.",
		"Ternary operator|c ? a : b gives a when c is true and b otherwise.",
		"Comma operator|The comma operator runs its left side, then gives the value of its right side.",
		"Order of evaluation|C does not fix the order in which a function's arguments are evaluated.",
		"Unary minus on unsigned|Negating an unsigned value wraps it around instead of making it negative.",
	]],
	["Control flow", 0.75, 0.8, [
		"if and else|An if runs its block when the condition is true, and else runs otherwise.",
		"Dangling else|An else belongs to the nearest if that has no else yet.",
		"while loop|A while loop checks its condition before every pass, so it may run zero times.",
		"do while loop|A do while loop runs its body once before checking the condition.",
		"for loop parts|A for loop has a start, a condition checked before each pass, and a step after each pass.",
		"break|break leaves the innermost loop or switch at once.",
		"continue|continue skips to the next pass of the innermost loop.",
		"switch on integers|A switch jumps to the case whose integer constant matches the value.",
		"Switch fallthrough|Without break, a switch case runs on into the next case.",
		"default case|The default case runs when no other case matches.",
		"Off-by-one loops|A loop with <= instead of < runs one extra time.",
		"Infinite loops|A loop whose condition never becomes false runs until the program is stopped.",
		"Nested loops|An inner loop runs all its passes for every single pass of the outer loop.",
		"Loop counter scope|A counter declared in the for statement exists only inside that loop.",
		"goto for cleanup|goto can jump to a cleanup label at the end of a function.",
		"Empty statement bug|A semicolon right after if (x) makes the if control nothing.",
	]],
	["Input and output", 0.6, 0.6, [
		"printf format|printf fills each % placeholder in its format with the next argument.",
		"Format specifiers|%d prints an int, %f a double, %c a char and %s a string.",
		"Field width|%5d prints an int padded with spaces to at least 5 characters.",
		"Printing a percent sign|%% in a format prints one percent sign.",
		"scanf needs addresses|scanf stores into variables through their addresses, so it takes &x.",
		"scanf return value|scanf returns how many values it read, which tells you if input failed.",
		"Leftover newline|scanf with %d leaves the newline in the input for the next read.",
		"getchar|getchar reads one character and returns EOF at the end of input.",
		"EOF is an int|getchar returns an int so that EOF can differ from every real character.",
		"Standard streams|Every program starts with stdin, stdout and stderr open.",
		"stderr for errors|Error messages go to stderr so they are not mixed into the program's output.",
		"Output buffering|Output to a terminal is usually sent line by line, when a newline is printed.",
		"fgets for lines|fgets reads a whole line up to a size limit, which makes it safer than gets.",
	]],
	["Functions", 0.7, 0.7, [
		"Function declaration|A function must be declared before it is called, with its return and parameter types.",
		"Prototypes|A prototype is a declaration without a body, usually put in a header.",
		"Pass by value|C copies each argument into the parameter, so changing a parameter leaves the caller's variable alone.",
		"Return value|return ends the function and hands one value back to the caller.",
		"void functions|A function with return type void gives back no value.",
		"Locals are fresh each call|Each call gets new local variables, gone when the call returns.",
		"Static locals|A static local variable keeps its value between calls.",
		"Recursion|A recursive function calls itself on a smaller version of the problem.",
		"Base case|Recursion needs a base case that returns without calling itself again.",
		"Stack overflow|Recursion that goes too deep uses up the stack and crashes the program.",
		"Call stack frames|Each call pushes a frame holding its locals and return address onto the stack.",
		"main's parameters|argc counts the command line words and argv holds them as strings.",
		"Function pointers|A function's name used without parentheses gives a pointer to it.",
		"Helper functions|Small helper functions make code easier to read and test.",
		"Missing return|Using the value of a function that ends without return is undefined behavior.",
	]],
	["Arrays", 0.75, 0.6, [
		"Indexes start at 0|The first element of an array is at index 0 and the last at size minus 1.",
		"Fixed array size|An array's size is set when it is declared and never changes.",
		"Out of bounds access|C does not check indexes, so reading past the end reads other memory.",
		"Array initializers|int a[3] = {1, 2, 3}; sets each element in order.",
		"Partial initializers|Elements left out of an initializer are set to 0.",
		"Array length with sizeof|sizeof(a) / sizeof(a[0]) gives the element count, but only where a is a real array.",
		"Arrays decay to pointers|An array used in an expression turns into a pointer to its first element.",
		"Arrays passed to functions|A function receives a pointer, not a copy of the array.",
		"Passing the length|A function taking an array needs its length as a separate parameter.",
		"2D arrays|A 2D array is stored row after row in one block of memory.",
		"Arrays cannot be assigned|One array cannot be copied into another with =.",
		"Looping over an array|A for loop from 0 to length minus 1 visits every element once.",
		"Variable-length arrays|A VLA takes its size from a variable at run time and lives on the stack.",
		"Arrays of structs|An array can hold structs, and a[i].field reads one field of one element.",
	]],
	["Pointers", 0.8, 0.45, [
		"Address-of operator|&x gives the address where x is stored in memory.",
		"Dereferencing|*p reads or writes the value at the address p holds.",
		"Pointer types|A pointer's type says what kind of value sits at the address it holds.",
		"NULL pointer|NULL is a pointer value that points to nothing.",
		"Dereferencing NULL|Reading through a NULL pointer usually crashes the program.",
		"Pointer arithmetic|Adding 1 to a pointer moves it by the size of the type it points to.",
		"Pointer subtraction|Subtracting two pointers into one array gives how many elements apart they are.",
		"Indexing is pointer arithmetic|a[i] means *(a + i).",
		"Pointers as out parameters|Passing &x lets a function change the caller's x.",
		"swap with pointers|A swap function needs pointers to both values to change them for the caller.",
		"Dangling pointer|A pointer to memory that was freed or went out of scope is dangling.",
		"Returning a local's address|Returning the address of a local variable gives a dangling pointer.",
		"void pointer|A void * can hold any object address but must be cast before it is dereferenced.",
		"Pointer to pointer|An int ** holds the address of an int *.",
		"const and pointers|const int *p protects the value, while int *const p protects the pointer.",
		"Pointer comparison|Pointers into the same array can be compared with < and >.",
		"Uninitialized pointer|A pointer that is never set points somewhere random.",
		"Pointer size|Every data pointer on a 64-bit machine takes 8 bytes.",
		"Arrow operator|p->x is short for (*p).x.",
		"Printing an address|%p in printf prints a pointer's address.",
		"Pointer versus array|sizeof on an array gives its full size, but on a pointer only the pointer's size.",
	]],
	["Strings", 0.65, 0.55, [
		"Strings end with a null byte|A C string is a char array that ends with the byte '\\0'.",
		"strlen|strlen counts characters up to the null byte, not counting it.",
		"String literals are read-only|Changing a string literal through a pointer is undefined behavior.",
		"char array versus char pointer|char s[] = \"hi\" makes a copy you can change, while char *s = \"hi\" points at the literal.",
		"Room for the null byte|A buffer for n characters needs n plus 1 bytes.",
		"strcpy|strcpy copies a string including its null byte, without checking the destination's size.",
		"strncpy pitfall|strncpy adds no null byte when the source fills the whole limit.",
		"strcmp|strcmp returns 0 when two strings are equal.",
		"Comparing with ==|== on two strings compares their addresses, not their text.",
		"strcat|strcat adds one string onto the end of another that must have room for it.",
		"Buffer overflow|Writing past a string buffer's end corrupts the memory next to it.",
		"snprintf|snprintf formats into a buffer and never writes more than the size you give it.",
		"Character arithmetic|c - '0' turns a digit character into its number.",
		"ctype functions|isdigit, isalpha and toupper test or change one character.",
		"strtol|strtol turns text into a number and reports where the number ended.",
		"Walking a string|A loop can walk a string until it reaches the null byte.",
	]],
	["Bitwise operations", 0.5, 0.5, [
		"Bitwise AND|a & b keeps only the bits set in both a and b.",
		"Bitwise OR|a | b sets every bit that is set in either a or b.",
		"Bitwise XOR|a ^ b sets the bits where a and b differ.",
		"Bitwise NOT|~a flips every bit of a.",
		"Left shift|a << n moves bits left by n places, multiplying by 2 to the n.",
		"Right shift|a >> n moves bits right by n places, dividing an unsigned value by 2 to the n.",
		"Shifting signed values|Right shifting a negative number is implementation defined.",
		"Testing a bit|x & (1 << n) is nonzero when bit n of x is set.",
		"Setting a bit|x |= 1 << n turns bit n on.",
		"Clearing a bit|x &= ~(1 << n) turns bit n off.",
		"Masks|A mask is a value whose set bits pick out the bits you care about.",
		"Hexadecimal literals|0xFF is 255, and each hex digit stands for 4 bits.",
		"Bitwise versus logical|& works bit by bit, while && treats each side as one true or false value.",
	]],
	["Memory layout", 0.55, 0.5, [
		"Stack holds locals|Local variables live on the stack and vanish when their function returns.",
		"Heap holds malloc memory|Memory from malloc lives on the heap until it is freed.",
		"Stack grows down|On most machines the stack grows toward lower addresses.",
		"Static data segment|Globals and static variables live in a data segment for the whole run.",
		"Code segment|The program's machine code sits in a read-only code segment.",
		"Byte addressing|Every byte in memory has its own address.",
		"Endianness|A little-endian machine stores the lowest byte of a number at the lowest address.",
		"Alignment|An int usually starts at an address that is a multiple of 4.",
		"Struct padding|The compiler adds padding inside structs to keep fields aligned.",
		"Two's complement|Negative ints are stored in two's complement, so -1 has every bit set.",
		"Virtual memory|Each process sees its own address space, mapped to real memory by the system.",
		"Segmentation fault|Touching memory the process does not own ends it with a segmentation fault.",
		"Stack size limit|The stack is small, often 8 MB, so huge local arrays can crash.",
		"Undefined behavior|Undefined behavior means the C standard promises nothing about what happens.",
	]],
	["Structs", 0.6, 0.7, [
		"Defining a struct|A struct groups named fields of different types into one type.",
		"Dot operator|s.x reads the field x of the struct s.",
		"typedef for structs|typedef gives a struct type a shorter name.",
		"Struct assignment copies|Assigning one struct to another copies every field.",
		"Passing structs|A struct passed to a function is copied, so big structs are passed by pointer.",
		"Struct pointers|A pointer to a struct reaches its fields with ->.",
		"Nested structs|A struct can contain another struct as a field.",
		"Self-referential structs|A struct can hold a pointer to its own type, but not itself.",
		"Designated initializers|{ .x = 1, .y = 2 } sets fields by name.",
		"Comparing structs|Structs cannot be compared with ==, so each field is compared.",
		"Struct size|sizeof a struct can be more than the sum of its fields because of padding.",
		"Unions|A union's fields share the same memory, so only one holds a value at a time.",
		"Enums|An enum names a set of integer constants.",
	]],
	["Dynamic memory", 0.45, 0.4, [
		"malloc|malloc(n) returns a pointer to n new bytes on the heap, or NULL if it fails.",
		"Checking malloc's result|Code must check malloc's result for NULL before using it.",
		"malloc with sizeof|malloc(n * sizeof *p) asks for room for n elements of p's type.",
		"free|free gives heap memory back so it can be used again.",
		"Memory leak|Memory that is never freed stays taken until the program ends.",
		"Double free|Freeing the same memory twice is undefined behavior.",
		"Use after free|Using memory after freeing it reads data that may already belong to something else.",
		"calloc|calloc allocates memory for an array and sets every byte to 0.",
		"realloc|realloc resizes a block and may move it to a new address.",
		"realloc failure|When realloc fails it returns NULL and leaves the old block alone.",
		"malloc does not zero|Bytes from malloc hold leftover values until you set them.",
		"Freeing NULL is safe|free(NULL) does nothing.",
		"Ownership|Each malloc should have one clear owner responsible for freeing it.",
		"Dynamic arrays|A growing array keeps its length and capacity and doubles the capacity when full.",
		"Valgrind|Valgrind reports leaks and invalid reads or writes while the program runs.",
		"NULL after free|Setting a pointer to NULL after free turns later mistakes into clear crashes.",
	]],
	["Linked lists", 0.25, 0.45, [
		"List node|A node holds a value and a pointer to the next node.",
		"Head pointer|The list is reached through a pointer to its first node.",
		"Empty list|An empty list is a head pointer that is NULL.",
		"Traversal|A loop follows next pointers until it reaches NULL.",
		"Insert at head|Inserting at the head takes constant time.",
		"Insert at tail|Inserting at the tail takes a walk to the end unless a tail pointer is kept.",
		"Deleting a node|Deleting a node links its previous node to its next one, then frees it.",
		"Pointer to the head|A function that changes the head takes a pointer to the head pointer.",
		"Freeing a list|Freeing a list saves each next pointer before freeing its node.",
		"Doubly linked list|Each node in a doubly linked list also points to the one before it.",
		"Lists versus arrays|A list grows one node at a time, but reaching the nth item takes n steps.",
		"Reversing a list|A list is reversed in place by turning each next pointer around.",
		"Sentinel node|A dummy first node removes the special case for an empty list.",
		"Cycle in a list|A list whose last node points back into it never reaches NULL.",
	]],
	["File handling", 0, 0.5, [
		"fopen|fopen opens a file and returns a FILE pointer, or NULL on failure.",
		"File modes|\"r\" reads, \"w\" writes over the file and \"a\" adds to its end.",
		"fclose|fclose flushes and closes a file, and every fopen needs one.",
		"fprintf|fprintf writes formatted text to a file like printf does to the screen.",
		"fscanf|fscanf reads formatted values from a file.",
		"Reading lines with fgets|fgets reads one line from a file into a buffer.",
		"feof after a read|feof only becomes true after a read has already failed.",
		"Binary files|fread and fwrite copy raw bytes between memory and a file.",
		"fseek and ftell|fseek moves the position in a file and ftell reports it.",
		"errno|When a library call fails it sets errno to say why.",
		"perror|perror prints a message for the current errno value.",
		"Text versus binary mode|On some systems text mode changes line endings while binary mode does not.",
		"Writing then reading|A file opened for both reading and writing needs fseek between the two.",
	]],
	["Debugging with GDB", 0.3, 0.75, [
		"Starting gdb|gdb ./prog loads the program in the debugger.",
		"Breakpoints|break sets a place where the program stops so you can look around.",
		"run|run starts the program inside gdb.",
		"next versus step|next runs the next line, while step goes into a function call.",
		"print|print shows the value of a variable or expression.",
		"backtrace|backtrace lists the calls that led to where the program stopped.",
		"Finding a segfault|Running a crashing program in gdb stops it at the line that crashed.",
		"Watchpoints|watch stops the program whenever a variable changes.",
		"continue in gdb|continue runs until the next breakpoint.",
		"Inspecting memory|x/4x &a shows four words of memory starting at a.",
		"Frames|frame n moves gdb to another call on the stack to see its locals.",
		"Printing a struct|print *p shows every field of the struct p points at.",
	]],
];

/** Learn the first, then the second. */
const NEEDS: [string, string][] = [
	["Variables and types", "Operators"],
	["Variables and types", "Control flow"],
	["Operators", "Control flow"],
	["Variables and types", "Input and output"],
	["Control flow", "Functions"],
	["Control flow", "Arrays"],
	["Arrays", "Pointers"],
	["Functions", "Pointers"],
	["Arrays", "Strings"],
	["Pointers", "Strings"],
	["Operators", "Bitwise operations"],
	["Pointers", "Memory layout"],
	["Functions", "Memory layout"],
	["Pointers", "Structs"],
	["Memory layout", "Dynamic memory"],
	["Pointers", "Dynamic memory"],
	["Structs", "Linked lists"],
	["Dynamic memory", "Linked lists"],
	["Input and output", "File handling"],
	["Strings", "File handling"],
	["Terminal and compiling", "Debugging with GDB"],
	["Memory layout", "Debugging with GDB"],
	["Terminal and compiling", "Functions"],
];

/** An intro C course: 16 topics, 232 facts with real names and statements, answer histories, links and chains. */
export function introC(): Space {
	const r = rng(29);
	const topics: TopicProgress[] = [];
	const facts: FactProgress[] = [];
	const chains: Space["chains"] = [];
	const ids = new Map<string, string>();
	let clock = Date.parse("2026-09-22T17:00:00Z");
	const answer = (fid: string, i: number, skill: number): AnswerRef => {
		const p = Math.min(0.95, skill + 0.07 * i);
		const x = r();
		const outcome: AnswerOutcome = x < p ? "right" : x < p + 0.12 ? "hinted" : x < p + 0.2 ? "dontKnow" : "wrong";
		clock += 3600_000 * (2 + Math.floor(r() * 30));
		return { chatId: "chat_course", toolCallId: `${fid}_${i}`, outcome, answeredAt: new Date(clock).toISOString() };
	};
	COURSE.forEach(([name, share, skill, lines]) => {
		const id = `tpc_${name.toLowerCase().replace(/\W+/g, "_")}`;
		ids.set(name, id);
		const mine: FactProgress[] = lines.map((line, k) => {
			const [fname, statement] = line.split("|") as [string, string];
			const fid = `${id}_f${k}`;
			const answered = r() < share;
			const n = answered ? 1 + Math.floor(r() ** 1.7 * 8) : 0;
			const answers = Array.from({ length: n }, (_, i) => answer(fid, i, skill));
			// Some facts came up in a lesson but were never asked.
			const inLessons = n > 0 || (share > 0 && r() < 0.35) || (share === 0 && r() < 0.5);
			if (k > 0 && r() < 0.5) {
				const p = Math.max(0, k - 1 - Math.floor(r() * 4));
				const premises = [`${id}_f${p}`];
				if (k > 2 && r() < 0.2) premises.push(`${id}_f${Math.floor(r() * p)}`);
				chains.push({ premises: [...new Set(premises)], conclusion: fid });
			}
			return { id: fid, name: fname, statement, topicId: id, born: inLessons ? "chat_course" : "src_notes", inLessons, answers };
		});
		facts.push(...mine);
		const all = mine.flatMap((f) => f.answers).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
		const t = tally(all);
		topics.push({ id, name, members: mine.map((f) => f.id), ...t, status: topicStatus(t.rate), color: rampColor(t.rate), overconfident: false, answers: all, column: 0 });
	});
	const byId = new Map(topics.map((t) => [t.id, t]));
	const links: TopicLink[] = NEEDS.map(([a, z]) => {
		const from = byId.get(ids.get(a)!)!;
		const to = byId.get(ids.get(z)!)!;
		const n = 1 + Math.floor(r() * 3);
		for (let i = 0; i < n; i++) chains.push({ premises: [from.members[Math.floor(r() * from.members.length)]!], conclusion: to.members[Math.floor(r() * to.members.length)]! });
		return { from: from.id, to: to.id, weight: n };
	});
	// A topic's column: the longest path to it from a topic that needs nothing.
	const col = (id: string, seen = new Set<string>()): number => {
		if (seen.has(id)) return 0;
		seen.add(id);
		const ins = links.filter((l) => l.to === id);
		return ins.length ? 1 + Math.max(...ins.map((l) => col(l.from, new Set(seen)))) : 0;
	};
	for (const t of topics) t.column = col(t.id);
	return { topics, links, facts, chains };
}

//! One way to take a lock: a panic in another thread must not stop the app from using the data.

use std::sync::{Mutex, MutexGuard, PoisonError};

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
	mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

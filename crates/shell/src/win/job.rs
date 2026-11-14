//! A Job Object holding everything an agent's start script starts, so Stop and quit end the whole
//! tree. Closing the job's handle kills it too, so nothing outlives the app.

use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

use portable_pty::Child;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
	AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
};

pub struct Job(OwnedHandle);

impl Job {
	/// A new job holding the child, assigned right after it started. The child is killed when
	/// that fails, since nothing could stop its tree.
	pub fn holding(child: &mut (dyn Child + Send + Sync)) -> Result<Job, String> {
		let job = Job::assign(&*child);
		if job.is_err() {
			let _ = child.kill();
		}
		job
	}

	fn assign(child: &(dyn Child + Send + Sync)) -> Result<Job, String> {
		let failed = |err: windows::core::Error| format!("cannot hold the terminal's processes: {err}");
		let process = child.as_raw_handle().ok_or("cannot hold the terminal's processes: no process handle")?;
		// SAFETY: a new unnamed job, owned at once; the limit struct outlives the call; the
		// process handle is the child's own, open while `child` lives.
		unsafe {
			let job = Job(OwnedHandle::from_raw_handle(CreateJobObjectW(None, None).map_err(failed)?.0));
			let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
			limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
			SetInformationJobObject(job.handle(), JobObjectExtendedLimitInformation, (&raw const limits).cast(), size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32).map_err(failed)?;
			AssignProcessToJobObject(job.handle(), HANDLE(process)).map_err(failed)?;
			Ok(job)
		}
	}

	fn handle(&self) -> HANDLE {
		HANDLE(self.0.as_raw_handle())
	}

	/// Ends every process in the job.
	pub fn kill(&self) {
		// SAFETY: the job's own open handle.
		let _ = unsafe { TerminateJobObject(self.handle(), 1) };
	}
}

use std::io;

use crate::cli::args::SkillCmd;
use crate::cli::CliResult;
use ripmail::install_skill_from_embed;

pub(crate) fn run_skill(sub: SkillCmd) -> CliResult {
    match sub {
        SkillCmd::Install => install_skill_from_embed(true).map_err(io::Error::other)?,
    }
    Ok(())
}

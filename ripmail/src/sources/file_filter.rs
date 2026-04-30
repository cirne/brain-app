//! Shared glob-based filtering for file sources (`localDir`, `googleDrive`, …).

use globset::{Glob, GlobSet, GlobSetBuilder};

/// Build an optional [`GlobSet`] from gitignore-style patterns. Empty slice ⇒ `None`.
pub fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, globset::Error> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        b.add(Glob::new(p)?);
    }
    Ok(Some(b.build()?))
}

/// `rel_path` is relative path under a root (`localDir`) or a file name for cloud sources.
pub fn path_allowed(rel_path: &str, include: &Option<GlobSet>, ignore: &Option<GlobSet>) -> bool {
    if let Some(inc) = include {
        if !inc.is_match(rel_path) {
            return false;
        }
    }
    if let Some(ign) = ignore {
        if ign.is_match(rel_path) {
            return false;
        }
    }
    true
}

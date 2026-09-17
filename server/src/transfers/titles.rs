use super::files::NewFile;

const MAX_TITLE: usize = 80;
const MAX_CONTRIBUTOR: usize = 60;
const NOTE_TITLE: &str = "Text";

/// A human name for the transfer: the dropped folder's name, or the first file's name.
pub(super) fn title(files: &[NewFile]) -> String {
    let first = files[0].path.as_str();
    let top = first.split('/').next().unwrap_or(first);
    let one_folder =
        files.len() > 1 && first.contains('/') && files.iter().all(|f| f.path.split('/').next() == Some(top));
    if one_folder {
        top.to_owned()
    } else {
        first.rsplit('/').next().unwrap_or(first).to_owned()
    }
}

/// A text transfer is called by its first line, the way a note app lists notes.
pub(super) fn note_title(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    let title: String = line.chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect();
    let title = title.trim();
    if title.is_empty() {
        NOTE_TITLE.to_owned()
    } else {
        title.to_owned()
    }
}

/// A contributor's name as the one folder their files go into, or None if nothing usable is left.
pub(super) fn contributor_folder(name: &str) -> Option<String> {
    let name: String = name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\'))
        .take(MAX_CONTRIBUTOR)
        .collect();
    let name = name.trim();
    (!name.is_empty() && name != "." && name != "..").then(|| name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_is_called_by_its_first_line() {
        assert_eq!(note_title("Wifi password\nhunter2"), "Wifi password");
        assert_eq!(
            note_title("\n\n   Shopping list  \nmilk"),
            "Shopping list",
            "past blank lines"
        );
        assert_eq!(note_title("   \n\t"), NOTE_TITLE);
        assert_eq!(note_title(&"x".repeat(200)).chars().count(), MAX_TITLE);
    }

    #[test]
    fn a_contributor_name_makes_one_folder_and_no_more() {
        assert_eq!(contributor_folder("Bob's iPhone").as_deref(), Some("Bob's iPhone"));
        assert_eq!(
            contributor_folder("a/b\\c").as_deref(),
            Some("abc"),
            "no nesting, no escaping upwards"
        );
        for unusable in ["", "   ", ".", "..", "/"] {
            assert_eq!(contributor_folder(unusable), None, "{unusable:?}");
        }
    }
}

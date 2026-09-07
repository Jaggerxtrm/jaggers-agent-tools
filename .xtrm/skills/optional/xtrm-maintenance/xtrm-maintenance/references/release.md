# Release maintenance

Before publication verify: clean intended source state, version/changelog identity,
package payload/registry generation, ownership/vendor parity, tests/build, and the release
artifact that users will actually install.

Run the repository's current release/prepublish scripts rather than copying an old list
of commands into the skill. If a generated artifact changes during prepublish, commit or
explain that source-derived change before release.
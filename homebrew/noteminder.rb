cask "noteminder" do
  version "1.1.1"
  sha256 :no_check

  # Determine URL based on architecture
  if Hardware::CPU.intel?
    url "https://github.com/hypn05/NoteMinder/releases/download/v#{version}/NoteMinder-#{version}.dmg",
        verified: "github.com/hypn05/NoteMinder/"
  else
    url "https://github.com/hypn05/NoteMinder/releases/download/v#{version}/NoteMinder-#{version}-arm64.dmg",
        verified: "github.com/hypn05/NoteMinder/"
  end

  name "NoteMinder"
  desc "Desktop note-taking application with collapsible sidebar"
  homepage "https://github.com/hypn05/NoteMinder"

  livecheck do
    url :homepage
    strategy :github_latest
  end

  app "NoteMinder.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/NoteMinder.app"],
                   sudo: true
  end

  zap trash: [
    "~/Library/Application Support/noteminder",
    "~/Library/Preferences/com.noteminder.app.plist",
    "~/Library/Saved Application State/com.noteminder.app.savedState",
  ]

  caveats <<~EOS
    NoteMinder is not signed with an Apple Developer certificate.
    
    The quarantine attributes have been removed automatically during installation,
    but if you still see "app is damaged" warnings, run:
    
      sudo xattr -cr /Applications/NoteMinder.app
    
    Then the app should open normally.
  EOS
end

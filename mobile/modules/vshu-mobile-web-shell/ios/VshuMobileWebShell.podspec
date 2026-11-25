Pod::Spec.new do |s|
  s.name = 'VshuMobileWebShell'
  s.version = '0.0.1'
  s.summary = 'WebView shell that serves one generation directory from a private origin'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Vshu'
  s.homepage = 'https://vshu.dev'
  s.source = { :git => 'https://github.com/vishu6213/vshu.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
